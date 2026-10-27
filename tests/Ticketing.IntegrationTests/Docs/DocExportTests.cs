using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Ticketing.Application.Docs;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Attachments;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Projects;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>PDF export (TKT-20, docs refinement 1.11, D-111): what the API hands the renderer, limits and who may export.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocExportTests(TicketingApiFactory api)
{
    private const string Svg = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 60" width="120" height="60"><text x="10" y="30">API</text></svg>""";

    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_page_exports_as_a_pdf_with_its_content_title_block_header_and_footer()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync(displayName: "Jane Doe"));
        await client.CreateProjectAsync("EXP");
        var folder = await client.CreateFolderAsync("EXP", "Architecture");
        var ticket = await client.CreateTicketAsync("EXP", "Charge the card");
        var page = await client.CreatePageAsync("EXP", "Payment flow", folder.Key, $"## Overview\n\nSee {ticket.Key}.");

        // Act
        var response = await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf?tz=Europe/Warsaw", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("application/pdf", response.Content.Headers.ContentType?.MediaType);
        Assert.StartsWith("EXP-Payment flow-", response.Content.Headers.ContentDisposition?.FileNameStar);
        Assert.Equal(FakePdfRenderer.Pdf, await response.Content.ReadAsByteArrayAsync(_ct));
        var request = api.Pdf.Last;
        var data = FakePdfRenderer.Data(request);
        Assert.Equal("single", data.GetProperty("mode").GetString());
        Assert.Equal("Jane Doe", data.GetProperty("exportedBy").GetString());
        var entry = Assert.Single(data.GetProperty("entries").EnumerateArray());
        Assert.Equal(page.Key, entry.GetProperty("key").GetString());
        Assert.Equal("Architecture / Payment flow", entry.GetProperty("path").GetString());
        Assert.Equal($"## Overview\n\nSee {ticket.Key}.", entry.GetProperty("content").GetString());
        var chip = Assert.Single(entry.GetProperty("references").GetProperty("tickets").EnumerateArray());
        Assert.Equal($"https://localhost/tickets/{ticket.Key}", chip.GetProperty("url").GetString());
        Assert.Contains("EXP · Payment flow", request.HeaderHtml);
        Assert.Contains("Architecture", request.HeaderHtml);
        Assert.Contains($"{page.Key} v1", request.FooterHtml);
        Assert.Contains("by Jane Doe · Private project", request.FooterHtml);
        Assert.Contains("class=\"pageNumber\"", request.FooterHtml);
    }

    [Fact]
    public async Task An_older_version_exports_its_own_title_and_content()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EXV");
        var ticket = await client.CreateTicketAsync("EXV", "Only in the first version");
        var page = await client.CreatePageAsync("EXV", "Draft plan", content: $"first {ticket.Key}");
        (await client.PatchDocAsync(page.Key, new { title = "Final plan", content = "second", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Act
        var old = await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf?version=1", _ct);
        var missing = await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf?version=9", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.OK, old.StatusCode);
        var entry = FakePdfRenderer.Data(api.Pdf.Last).GetProperty("entries")[0];
        Assert.Equal("Draft plan", entry.GetProperty("title").GetString());
        Assert.Equal($"first {ticket.Key}", entry.GetProperty("content").GetString());
        Assert.Equal(1, entry.GetProperty("version").GetInt32());
        Assert.Equal(ticket.Key, Assert.Single(entry.GetProperty("references").GetProperty("tickets").EnumerateArray()).GetProperty("key").GetString());
        Assert.Contains($"{page.Key} v1", api.Pdf.Last.FooterHtml);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.VersionNotFound);
    }

    [Fact]
    public async Task A_canvas_diagram_exports_its_stored_picture_and_never_its_source()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EXC");
        var drawn = await client.CreateDocAsync("EXC", new { kind = "Diagram", diagramFormat = "Canvas", title = "Sketch", content = DocCanvasTests.ApiToDb(), snapshot = Svg });
        var blank = await client.CreateDocAsync("EXC", new { kind = "Diagram", diagramFormat = "Canvas", title = "Unrendered", content = DocCanvasTests.ApiToDb() });

        // Act
        (await client.GetAsync($"/api/v1/docs/{drawn.Key}/export.pdf", _ct)).EnsureSuccessStatusCode();
        var withPicture = api.Pdf.Last;
        (await client.GetAsync($"/api/v1/docs/{blank.Key}/export.pdf", _ct)).EnsureSuccessStatusCode();
        var withoutPicture = api.Pdf.Last;

        // Assert
        var entry = FakePdfRenderer.Data(withPicture).GetProperty("entries")[0];
        Assert.Equal(JsonValueKind.Null, entry.GetProperty("content").ValueKind);
        var file = Assert.Single(withPicture.Files);
        Assert.Equal(entry.GetProperty("picture").GetString(), file.Name);
        Assert.Equal(Svg, System.Text.Encoding.UTF8.GetString(file.Content.Span));
        Assert.Equal(JsonValueKind.Null, FakePdfRenderer.Data(withoutPicture).GetProperty("entries")[0].GetProperty("picture").ValueKind);
        Assert.Empty(withoutPicture.Files);
    }

    [Fact]
    public async Task A_folder_exports_its_subtree_in_tree_order_without_deleted_docs_and_links_inside_the_pdf()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EXF");
        var folder = await client.CreateFolderAsync("EXF", "Architecture");
        var outside = await client.CreatePageAsync("EXF", "Outside");
        var second = await client.CreatePageAsync("EXF", "Second", folder.Key);
        var sub = await client.CreateFolderAsync("EXF", "Decisions", folder.Key);
        var adr = await client.CreatePageAsync("EXF", "Use Postgres", sub.Key, $"Read {second.Key} and {outside.Key}.");
        var gone = await client.CreatePageAsync("EXF", "Gone", folder.Key);
        (await client.DeleteAsync($"/api/v1/docs/{gone.Key}", _ct)).EnsureSuccessStatusCode();
        (await client.MoveDocAsync(second.Key, new { parent = folder.Key, position = "Top" })).EnsureSuccessStatusCode();

        // Act
        var response = await client.GetAsync($"/api/v1/docs/{folder.Key}/export.pdf", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var request = api.Pdf.Last;
        var data = FakePdfRenderer.Data(request);
        Assert.Equal("folder", data.GetProperty("mode").GetString());
        Assert.Equal(2, data.GetProperty("folder").GetProperty("documents").GetInt32());
        var entries = data.GetProperty("entries").EnumerateArray().ToList();
        Assert.Equal(
            [$"{second.Key} 1", $"{sub.Key} 1", $"{adr.Key} 2"],
            entries.Select(e => $"{e.GetProperty("key").GetString()} {e.GetProperty("depth").GetInt32()}"));
        var links = entries[2].GetProperty("references").GetProperty("docs").EnumerateArray()
            .ToDictionary(d => d.GetProperty("key").GetString()!, d => d.GetProperty("url").GetString());
        Assert.Equal($"#{second.Key}", links[second.Key]);
        Assert.StartsWith($"https://localhost/p/EXF/docs/{outside.Key}/", links[outside.Key]);
        Assert.Contains($"{folder.Key} · 2 documents", request.FooterHtml);
        Assert.Contains("EXF · Architecture", request.HeaderHtml);
        Assert.DoesNotContain("Gone", request.IndexHtml);
    }

    [Fact]
    public async Task Page_images_travel_with_the_bundle_as_files()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EXI");
        var page = await client.CreatePageAsync("EXI", "Screens");
        var image = await (await client.UploadDocAttachmentAsync(page.Key, "flow.png", "image/png", AttachmentTests.Png))
            .ReadAsync<Ticketing.Application.Attachments.DocAttachmentDto>(HttpStatusCode.Created);
        (await client.PatchDocAsync(page.Key, new { content = $"![Flow]({image.Url})", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Act
        (await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct)).EnsureSuccessStatusCode();

        // Assert
        var request = api.Pdf.Last;
        var file = Assert.Single(request.Files);
        Assert.Equal(AttachmentTests.Png, file.Content.ToArray());
        var images = FakePdfRenderer.Data(request).GetProperty("entries")[0].GetProperty("images");
        Assert.Equal(file.Name, images.GetProperty(image.Url).GetString());
    }

    [Fact]
    public async Task Viewers_and_archived_projects_can_export()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        var project = await owner.CreateProjectAsync("EXA");
        var page = await owner.CreatePageAsync("EXA", "Handbook", content: "Read me");
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        (await owner.PostAsync("/api/v1/projects/EXA/archive", null, _ct)).EnsureSuccessStatusCode();

        // Act
        var byViewer = await viewer.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct);
        var byOwner = await owner.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.OK, byViewer.StatusCode);
        Assert.Equal(HttpStatusCode.OK, byOwner.StatusCode);
    }

    [Fact]
    public async Task Folders_have_no_versions_and_more_than_300_documents_are_too_large()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var client = await api.LoginAsync(ownerUser);
        var project = await client.CreateProjectAsync("EXL");
        var folder = await client.CreateFolderAsync("EXL", "Huge");
        await api.PagesAsync(project.Id, folder.Id, ownerUser.Id, DocPrint.MaxDocuments + 1);

        // Act
        var versioned = await client.GetAsync($"/api/v1/docs/{folder.Key}/export.pdf?version=1", _ct);
        var huge = await client.GetAsync($"/api/v1/docs/{folder.Key}/export.pdf", _ct);

        // Assert
        await versioned.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await huge.ShouldBeProblemAsync(HttpStatusCode.BadRequest, DocErrors.ExportTooLarge);
        Assert.Empty(api.Pdf.Requests);
    }

    [Fact]
    public async Task Beyond_two_running_and_ten_waiting_exports_the_api_answers_busy_with_retry_after()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EXB");
        var page = await client.CreatePageAsync("EXB", "Busy");
        var queue = api.Services.GetRequiredService<DocExportQueue>();
        api.Pdf.Hold();
        var admitted = Enumerable.Range(0, DocExportQueue.MaxRunning + DocExportQueue.MaxQueued)
            .Select(_ => client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct))
            .ToList();
        while (queue.Admitted < DocExportQueue.MaxRunning + DocExportQueue.MaxQueued || api.Pdf.Running < DocExportQueue.MaxRunning)
            await Task.Delay(20, _ct);

        // Act
        var rejected = await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct);
        api.Pdf.Release();
        var finished = await Task.WhenAll(admitted);

        // Assert
        await rejected.ShouldBeProblemAsync((HttpStatusCode)429, DocErrors.ExportBusy);
        Assert.Equal("15", rejected.Headers.RetryAfter?.Delta?.TotalSeconds.ToString(System.Globalization.CultureInfo.InvariantCulture));
        Assert.All(finished, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        Assert.Equal(0, queue.Admitted);
    }

    [Fact]
    public async Task Without_a_configured_renderer_export_is_unavailable_and_anonymous_callers_must_sign_in()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("EXU");
        var page = await client.CreatePageAsync("EXU", "Offline");
        api.Pdf.IsAvailable = false;

        // Act
        var unavailable = await client.GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct);
        var anonymous = await api.CreateBrowserClient().GetAsync($"/api/v1/docs/{page.Key}/export.pdf", _ct);

        // Assert
        await unavailable.ShouldBeProblemAsync(HttpStatusCode.ServiceUnavailable, DocErrors.ExportUnavailable);
        Assert.Equal(HttpStatusCode.Unauthorized, anonymous.StatusCode);
    }

    [Fact]
    public async Task An_export_link_downloads_without_credentials_for_its_doc_only()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("EXK");
        var page = await client.CreatePageAsync("EXK", "Linked", content: "first");
        (await client.PatchDocAsync(page.Key, new { content = "second", baseVersion = 1 })).EnsureSuccessStatusCode();
        var other = await client.CreatePageAsync("EXK", "Other");
        var link = await (await client.PostAsJsonAsync($"/api/v1/docs/{page.Key}/export-link", new { version = 1 }, _ct)).ReadAsync<DocExportLinkDto>();
        var anonymous = api.CreateBrowserClient();

        // Act
        var download = await anonymous.GetAsync(link.Url, _ct);
        var token = link.Url[(link.Url.IndexOf("token=", StringComparison.Ordinal) + 6)..];
        var foreign = await anonymous.GetAsync($"/api/v1/docs/{other.Key}/export.pdf?token={token}", _ct);
        var tampered = await anonymous.GetAsync($"/api/v1/docs/{page.Key}/export.pdf?token={token[..^4]}AAAA", _ct);

        // Assert
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.Equal("first", FakePdfRenderer.Data(api.Pdf.Last).GetProperty("entries")[0].GetProperty("content").GetString());
        Assert.InRange(link.ExpiresAt, DateTimeOffset.UtcNow.AddMinutes(14), DateTimeOffset.UtcNow.AddMinutes(16));
        await foreign.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
        await tampered.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
    }

    [Fact]
    public async Task An_export_link_dies_when_it_expires_or_its_user_is_deactivated()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("EXD");
        var page = await client.CreatePageAsync("EXD", "Short lived");
        var links = api.Services.GetRequiredService<Ticketing.Application.Abstractions.IDocExportLinks>();
        var stamp = await api.WithDbAsync(db => Task.FromResult(db.Users.Single(u => u.Id == user.Id).SecurityStamp));
        var expired = links.Create(new Ticketing.Application.Abstractions.DocExportGrant(user.Id, page.Id, null, stamp), DateTimeOffset.UtcNow.AddSeconds(-1));
        var link = await (await client.PostAsync($"/api/v1/docs/{page.Key}/export-link", null, _ct)).ReadAsync<DocExportLinkDto>();
        var anonymous = api.CreateBrowserClient();

        // Act
        var afterExpiry = await anonymous.GetAsync($"/api/v1/docs/{page.Key}/export.pdf?token={Uri.EscapeDataString(expired)}", _ct);
        await api.DeactivateAsync(user);
        var afterDeactivation = await anonymous.GetAsync(link.Url, _ct);

        // Assert
        await afterExpiry.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
        await afterDeactivation.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
        Assert.Empty(api.Pdf.Requests);
    }

    [Fact]
    public async Task Mcp_get_doc_export_link_returns_a_working_link()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("EXM");
        var folder = await client.CreateFolderAsync("EXM", "Runbooks");
        await client.CreatePageAsync("EXM", "Restart", folder.Key);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, Ticketing.Domain.Tokens.PatScope.ReadOnly));

        // Act
        var result = await mcp.CallToolAsync("get_doc_export_link", new Dictionary<string, object?> { ["docKey"] = folder.Key }, cancellationToken: _ct);
        var url = JsonDocument.Parse(Assert.IsType<ModelContextProtocol.Protocol.TextContentBlock>(Assert.Single(result.Content)).Text).RootElement.GetProperty("url").GetString()!;
        var download = await api.CreateBrowserClient().GetAsync(url, _ct);

        // Assert
        Assert.NotEqual(true, result.IsError);
        Assert.StartsWith($"/api/v1/docs/{folder.Key}/export.pdf?token=", url);
        Assert.Equal(HttpStatusCode.OK, download.StatusCode);
        Assert.EndsWith(" UTC", FakePdfRenderer.Data(api.Pdf.Last).GetProperty("exportedAt").GetString());
    }
}
