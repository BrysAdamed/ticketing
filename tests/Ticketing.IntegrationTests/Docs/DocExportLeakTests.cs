using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Attachments;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Attachments;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// PDF exports never leak (spec 1.5, docs refinement 1.11): private docs answer outsiders like missing ones, and an export
/// carries only what the exporter can read. The assertions run on the bundle posted to the renderer, which is everything
/// the PDF could ever show (D-100).
/// </summary>
[Collection(nameof(DocsCollection))]
public sealed class DocExportLeakTests(TicketingApiFactory api)
{
    private const string SecretSvg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>Vault layout</text></svg>""";

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Outsiders_get_the_same_404_as_for_missing_docs_from_every_export_path()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("XSEC");
        var page = await owner.CreatePageAsync("XSEC", "Plans", content: "secret");
        var outsiderUser = await api.CreateUserAsync();
        var outsider = await api.LoginAsync(outsiderUser);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsiderUser));

        // Act
        var export = await outsider.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct);
        var missingExport = await outsider.GetAsync("/api/v1/docs/XSEC-D-999/export.pdf", _ct);
        var link = await outsider.PostAsync($"/api/v1/docs/{page.Key}/export-link", null, _ct);
        var missingLink = await outsider.PostAsync("/api/v1/docs/XSEC-D-999/export-link", null, _ct);
        var tool = await mcp.CallToolAsync("get_doc_export_link", new Dictionary<string, object?> { ["docKey"] = page.Key }, cancellationToken: _ct);
        var missingTool = await mcp.CallToolAsync("get_doc_export_link", new Dictionary<string, object?> { ["docKey"] = "XSEC-D-999" }, cancellationToken: _ct);

        // Assert
        await SameAsMissingAsync(export, missingExport, page.Key);
        await SameAsMissingAsync(link, missingLink, page.Key);
        Assert.True(tool.IsError);
        Assert.Equal(Text(missingTool).Replace("XSEC-D-999", page.Key, StringComparison.Ordinal), Text(tool));
        Assert.Empty(api.Pdf.Requests);
    }

    [Fact]
    public async Task An_export_holds_no_title_source_picture_or_image_from_a_project_the_exporter_cannot_read()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("XVLT");
        var secretTicket = await owner.CreateTicketAsync("XVLT", "Vault combination");
        var secretPage = await owner.CreatePageAsync("XVLT", "Vault runbook");
        var secretFlow = await owner.CreateDiagramAsync("XVLT", "Vault flow", "Mermaid", "flowchart LR\n  VaultDoor --> VaultRoom");
        var secretSketch = await owner.CreateDocAsync("XVLT", new { kind = "Diagram", diagramFormat = "Canvas", title = "Vault sketch", content = DocCanvasTests.ApiToDb(), snapshot = SecretSvg });
        var secretImage = await (await AttachmentTests.UploadAsync(owner, secretTicket.Key, "vault.png", "image/png", AttachmentTests.Png))
            .ReadAsync<AttachmentDto>(HttpStatusCode.Created);
        var shared = await owner.CreateProjectAsync("XPUB");
        var exporterUser = await api.CreateUserAsync();
        await api.AddMemberAsync(shared.Id, exporterUser, ProjectRole.Viewer);
        var folder = await owner.CreateFolderAsync("XPUB", "Handbook");
        await owner.CreatePageAsync("XPUB", "Overview", folder.Key,
            $"Ask {secretTicket.Key}, see {secretPage.Key} and [the runbook]({secretPage.Key}).\n\n![Flow]({secretFlow.Key})\n\n![Sketch]({secretSketch.Key})\n\n![Image]({secretImage.Url})");
        var exporter = await api.LoginAsync(exporterUser);

        // Act
        var page = await exporter.GetAsync($"/api/v1/docs/{folder.Key}/export.pdf", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        var request = api.Pdf.Last;
        var everything = FakePdfRenderer.Everything(request);
        foreach (var secret in new[] { "Vault combination", "Vault runbook", "Vault flow", "VaultDoor", "Vault sketch", "Vault layout", "XVLT · " })
            Assert.DoesNotContain(secret, everything, StringComparison.Ordinal);
        Assert.Empty(request.Files);
        var entry = FakePdfRenderer.Data(request).GetProperty("entries")[0];
        var references = entry.GetProperty("references");
        Assert.Empty(references.GetProperty("tickets").EnumerateArray());
        Assert.Empty(references.GetProperty("docs").EnumerateArray());
        Assert.Empty(references.GetProperty("embeds").EnumerateArray());
        Assert.Empty(entry.GetProperty("images").EnumerateObject());
    }

    [Fact]
    public async Task An_export_link_answers_404_once_its_user_lost_access()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var project = await owner.CreateProjectAsync("XREV");
        var page = await owner.CreatePageAsync("XREV", "Plans");
        var memberUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, memberUser, ProjectRole.Member);
        var member = await api.LoginAsync(memberUser);
        var link = await (await member.PostAsync($"/api/v1/docs/{page.Key}/export-link", null, _ct)).ReadAsync<DocExportLinkDto>();
        await api.WithDbAsync(db => db.ProjectMembers.Where(m => m.ProjectId == project.Id && m.UserId == memberUser.Id).ExecuteDeleteAsync(_ct));

        // Act
        var response = await api.CreateBrowserClient().GetAsync(link.Url, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
        Assert.Empty(api.Pdf.Requests);
    }

    private static async Task SameAsMissingAsync(HttpResponseMessage hidden, HttpResponseMessage missing, string key)
    {
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal(missing.StatusCode, hidden.StatusCode);
        var hiddenProblem = await hidden.Content.ReadFromJsonAsync<JsonElement>();
        var missingProblem = await missing.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal(missingProblem.GetProperty("code").GetString(), hiddenProblem.GetProperty("code").GetString());
        Assert.Equal(
            missingProblem.GetProperty("title").GetString()!.Replace("XSEC-D-999", key, StringComparison.Ordinal),
            hiddenProblem.GetProperty("title").GetString());
    }

    private static string Text(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement.GetProperty("message").GetString()!;
}
