using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Attachments;
using Ticketing.Application.Docs;
using Ticketing.Domain.Attachments;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Attachments;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Projects;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Private-project docs never leak (spec 1.5): every read path answers an outsider exactly like a doc that does not exist.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Outsiders_get_the_same_404_as_for_missing_docs_on_every_rest_read()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("SECRET");
        var folder = await owner.CreateFolderAsync("SECRET", "Folder");
        var page = await owner.CreatePageAsync("SECRET", "Plans", folder.Key);
        await (await owner.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, content = "x" }, _ct)).ReadAsync<DocDraftDto>();
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act + Assert
        await SameAsMissingAsync(outsider, $"/api/v1/docs/{page.Key}", "/api/v1/docs/SECRET-D-999", page.Key, "SECRET-D-999");
        await SameAsMissingAsync(outsider, $"/api/v1/docs/{page.Id}", $"/api/v1/docs/{Guid.NewGuid()}", page.Id.ToString(), null);
        await SameAsMissingAsync(outsider, $"/api/v1/docs/{page.Key}/draft", "/api/v1/docs/SECRET-D-999/draft", page.Key, "SECRET-D-999");
        foreach (var path in new[] { "/docs/tree", "/docs/recent", "/docs/trash", "/docs/by-path?path=Folder/Plans" })
            await SameAsMissingAsync(outsider, $"/api/v1/projects/SECRET{path}", $"/api/v1/projects/NOPE{path}", "SECRET", "NOPE");
        foreach (var write in new[]
        {
            await outsider.PatchDocAsync(page.Key, new { title = "x" }),
            await outsider.MoveDocAsync(page.Key, new { parent = "root" }),
            await outsider.DeleteAsync($"/api/v1/docs/{page.Key}", _ct),
            await outsider.PostAsync($"/api/v1/docs/{page.Key}/restore", null, _ct),
            await outsider.PostAsJsonAsync("/api/v1/projects/SECRET/docs", new { kind = "Page", title = "x" }, _ct),
        })
            Assert.Equal(HttpStatusCode.NotFound, write.StatusCode);
    }

    [Fact]
    public async Task Outsiders_get_the_same_404_as_for_missing_docs_for_attachments_versions_and_exports()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("VAULT");
        var page = await owner.CreatePageAsync("VAULT", "Plans", content: "secret");
        var uploaded = await (await owner.UploadDocAttachmentAsync(page.Key, "plan.json", "application/json", "{\"a\":1}"u8.ToArray()))
            .ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());
        var missingAttachment = $"/api/v1/attachments/{Guid.NewGuid()}";

        // Act + Assert
        foreach (var path in new[] { "/attachments", "/versions/1", "/export.md" })
            await SameAsMissingAsync(outsider, $"/api/v1/docs/{page.Key}{path}", $"/api/v1/docs/VAULT-D-999{path}", page.Key, "VAULT-D-999");
        await SameAsMissingAsync(
            await outsider.UploadDocAttachmentAsync(page.Key, "a.png", "image/png", AttachmentTests.Png),
            await outsider.UploadDocAttachmentAsync("VAULT-D-999", "a.png", "image/png", AttachmentTests.Png),
            page.Key, "VAULT-D-999");
        await SameAsMissingAsync(outsider, uploaded.Url, missingAttachment, uploaded.Url, missingAttachment);
        await SameAsMissingAsync(await outsider.DeleteAsync(uploaded.Url, _ct), await outsider.DeleteAsync(missingAttachment, _ct), uploaded.Url, missingAttachment);
        Assert.Equal(1, await api.WithDbAsync(db => db.Attachments.CountAsync(_ct)));
    }

    [Fact]
    public async Task Outsiders_get_not_found_from_mcp_doc_attachment_tools()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("LOCK");
        var page = await owner.CreatePageAsync("LOCK", "Plans");
        var uploaded = await (await owner.UploadDocAttachmentAsync(page.Key, "plan.txt", "text/plain", "secret"u8.ToArray()))
            .ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync()));

        // Act
        var list = await mcp.CallToolAsync("list_doc_attachments", new Dictionary<string, object?> { ["docKey"] = page.Key }, cancellationToken: _ct);
        var missingList = await mcp.CallToolAsync("list_doc_attachments", new Dictionary<string, object?> { ["docKey"] = "LOCK-D-999" }, cancellationToken: _ct);
        var text = await mcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = uploaded.Id }, cancellationToken: _ct);
        var missingText = await mcp.CallToolAsync("get_attachment_text", new Dictionary<string, object?> { ["attachmentId"] = Guid.NewGuid() }, cancellationToken: _ct);

        // Assert
        Assert.Equal(DocErrors.NotFound, Code(list));
        Assert.Equal(Message(missingList).Replace("LOCK-D-999", page.Key, StringComparison.Ordinal), Message(list));
        Assert.Equal(AttachmentErrors.NotFound, Code(text));
        Assert.Equal(Message(missingText), Message(text));
    }

    [Fact]
    public async Task Outsiders_get_not_found_from_mcp_doc_tools()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        await owner.CreateProjectAsync("HIDE");
        var page = await owner.CreatePageAsync("HIDE", "Plans");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(await api.CreateUserAsync()));

        // Act
        var byKey = await mcp.CallToolAsync("get_doc", new Dictionary<string, object?> { ["docKey"] = page.Key }, cancellationToken: _ct);
        var missingKey = await mcp.CallToolAsync("get_doc", new Dictionary<string, object?> { ["docKey"] = "HIDE-D-999" }, cancellationToken: _ct);
        var byPath = await mcp.CallToolAsync("get_doc", new Dictionary<string, object?> { ["projectKey"] = "HIDE", ["path"] = "Plans" }, cancellationToken: _ct);
        var list = await mcp.CallToolAsync("list_docs", new Dictionary<string, object?> { ["projectKey"] = "HIDE" }, cancellationToken: _ct);
        var missingList = await mcp.CallToolAsync("list_docs", new Dictionary<string, object?> { ["projectKey"] = "NOPE" }, cancellationToken: _ct);

        // Assert
        Assert.Equal(DocErrors.NotFound, Code(byKey));
        Assert.Equal(Message(missingKey).Replace("HIDE-D-999", page.Key, StringComparison.Ordinal), Message(byKey));
        Assert.Equal(ProjectErrors.NotFound, Code(byPath));
        Assert.Equal(ProjectErrors.NotFound, Code(list));
        Assert.Equal(Message(missingList).Replace("NOPE", "HIDE", StringComparison.Ordinal), Message(list));
    }

    [Fact]
    public async Task Doc_queries_composed_with_readable_projects_only_return_visible_docs()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var priv = await api.ProjectAsync(owner, "PRIV", ProjectVisibility.Private, (member, ProjectRole.Member));
        var pub = await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public);
        await api.PagesAsync(priv, null, owner.Id, 1);
        await api.PagesAsync(pub, null, owner.Id, 1, firstNumber: 1);

        // Act
        var asAdmin = await VisibleDocNumbersAsync(admin);
        var asMember = await VisibleDocNumbersAsync(member);
        var asOutsider = await VisibleDocNumbersAsync(outsider);

        // Assert
        Assert.Equal([1, 100_000], asAdmin);
        Assert.Equal([1, 100_000], asMember);
        Assert.Equal([1], asOutsider);
    }

    private async Task SameAsMissingAsync(HttpClient client, string hiddenUrl, string missingUrl, string hiddenRef, string? missingRef) =>
        await SameAsMissingAsync(await client.GetAsync(hiddenUrl, _ct), await client.GetAsync(missingUrl, _ct), hiddenRef, missingRef);

    private async Task SameAsMissingAsync(HttpResponseMessage hidden, HttpResponseMessage missing, string hiddenRef, string? missingRef)
    {
        Assert.Equal(HttpStatusCode.NotFound, hidden.StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, missing.StatusCode);
        var hiddenBody = await hidden.Content.ReadFromJsonAsync<JsonElement>(_ct);
        var missingBody = await missing.Content.ReadFromJsonAsync<JsonElement>(_ct);
        Assert.Equal(missingBody.GetProperty("code").GetString(), hiddenBody.GetProperty("code").GetString());
        var expectedTitle = missingRef is null ? null : missingBody.GetProperty("title").GetString()!.Replace(missingRef, hiddenRef, StringComparison.Ordinal);
        if (expectedTitle is not null)
            Assert.Equal(expectedTitle, hiddenBody.GetProperty("title").GetString());
    }

    private Task<List<int>> VisibleDocNumbersAsync(TestUser user) =>
        api.ExecuteAsAsync(user, sp =>
        {
            var db = sp.GetRequiredService<ITicketingDbContext>();
            var access = sp.GetRequiredService<IProjectAccess>();
            return db.DocNodes
                .Where(n => n.DeletedAt == null && access.ReadableProjects().Any(p => p.Id == n.ProjectId))
                .OrderBy(n => n.Number)
                .Select(n => n.Number)
                .ToListAsync(_ct);
        });

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;

    private static string? Code(CallToolResult result)
    {
        Assert.True(result.IsError);
        return Payload(result).GetProperty("code").GetString();
    }

    private static string Message(CallToolResult result) => Payload(result).GetProperty("message").GetString()!;
}
