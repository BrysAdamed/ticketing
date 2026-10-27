using System.Net.Http.Json;
using System.Text.Json;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Search;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// Docs search never leaks (TKT-19): private-project docs stay out of search, quick jump and MCP; drafts are never matched;
/// deleted docs are excluded; content is returned as plain text.
/// </summary>
[Collection(nameof(DocsCollection))]
public sealed class DocSearchLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Private_docs_never_appear_in_search_quick_jump_or_mcp_for_outsiders()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var viewerUser = await api.CreateUserAsync();
        var outsiderUser = await api.CreateUserAsync();
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var owner = await api.LoginAsync(ownerUser);
        var hidden = await owner.CreateProjectAsync("LKA");
        await api.AddMemberAsync(hidden.Id, viewerUser, ProjectRole.Viewer);
        await owner.CreateProjectAsync("LKB", ProjectVisibility.Public);
        var folder = await owner.CreateFolderAsync("LKA", "Secret plans");
        var secret = await owner.CreatePageAsync("LKA", "Quasar launch", folder.Key, "The quasar budget is confidential.");
        var ticket = await owner.CreateTicketAsync("LKA", "Quasar ticket");
        await api.MentionAsync(secret.Id, ticket.Id);
        var open = await owner.CreatePageAsync("LKB", "Public quasar notes", content: "Everyone may read about the quasar.");
        var outsider = await api.LoginAsync(outsiderUser);
        var viewer = await api.LoginAsync(viewerUser);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsiderUser));

        // Act
        var byText = await outsider.SearchDocKeysAsync("q=quasar");
        var all = await outsider.SearchDocKeysAsync("project=LKA,LKB");
        var byProject = await outsider.SearchDocsAsync("project=LKA");
        var byFolder = await outsider.SearchDocsAsync($"folder={folder.Key}");
        var byKey = await outsider.SearchDocsAsync($"q={secret.Key}");
        var byMention = await outsider.SearchDocsAsync($"mentions={ticket.Key}");
        var jumpKey = await outsider.QuickJumpAsync(secret.Key);
        var jumpText = await outsider.QuickJumpAsync("quasar");
        var viaMcp = await mcp.CallToolAsync("search_docs", new Dictionary<string, object?> { ["text"] = "quasar" }, cancellationToken: _ct);
        var asViewer = await viewer.SearchDocKeysAsync("q=quasar");
        var asAdmin = await admin.SearchDocKeysAsync("q=quasar");

        // Assert
        Assert.Equal([open.Key], byText);
        Assert.Equal([open.Key], all);
        Assert.All([byProject, byFolder, byKey, byMention], page =>
        {
            Assert.Empty(page.Items);
            Assert.Equal(0, page.Total);
        });
        Assert.Empty(jumpKey);
        Assert.Equal([open.Key], jumpText.Where(i => i.Kind == QuickJumpKind.Doc).Select(i => i.Key));
        var mcpText = Assert.IsType<TextContentBlock>(Assert.Single(viaMcp.Content)).Text;
        Assert.DoesNotContain("LKA", mcpText, StringComparison.Ordinal);
        Assert.DoesNotContain("confidential", mcpText, StringComparison.Ordinal);
        Assert.Equal(new[] { secret.Key, open.Key }.Order(StringComparer.Ordinal), asViewer.Order(StringComparer.Ordinal));
        Assert.Equal(new[] { secret.Key, open.Key }.Order(StringComparer.Ordinal), asAdmin.Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Drafts_are_never_matched_and_deleted_docs_are_excluded()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("LKC", ProjectVisibility.Public);
        var page = await owner.CreatePageAsync("LKC", "Roadmap", content: "Published text about nebulas.");
        var draft = await owner.PutAsJsonAsync(
            $"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, title = "Zeppelin roadmap", content = "Unpublished zeppelin plans." }, HttpAssertions.Json, _ct);
        draft.EnsureSuccessStatusCode();
        var folder = await owner.CreateFolderAsync("LKC", "Archive");
        var gone = await owner.CreatePageAsync("LKC", "Old nebulas", folder.Key, "Deleted nebulas.");
        (await owner.DeleteAsync($"/api/v1/docs/{folder.Key}", _ct)).EnsureSuccessStatusCode();
        var other = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var draftAsOwner = await owner.SearchDocsAsync("q=zeppelin");
        var draftAsOther = await other.SearchDocsAsync("q=zeppelin");
        var deleted = await owner.SearchDocKeysAsync("q=nebulas");
        var deletedByKey = await owner.QuickJumpAsync(gone.Key);
        var listing = await owner.SearchDocKeysAsync("project=LKC");

        // Assert
        Assert.Empty(draftAsOwner.Items);
        Assert.Empty(draftAsOther.Items);
        Assert.Equal([page.Key], deleted);
        Assert.Empty(deletedByKey);
        Assert.Equal([page.Key], listing);
    }

    [Fact]
    public async Task Markup_in_content_comes_back_as_plain_text_never_rendered()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("LKD");
        await owner.CreatePageAsync("LKD", "Injection sample", content: "Payload <img src=x onerror=alert(1)> and <script>alert('xss')</script> follow.");

        // Act
        var response = await owner.GetAsync("/api/v1/docs/search?q=payload", _ct);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(_ct);

        // Assert
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var snippet = body.GetProperty("items")[0].GetProperty("snippet").GetProperty("text").GetString();
        Assert.Contains("<img src=x onerror=alert(1)>", snippet, StringComparison.Ordinal);
        Assert.Contains("alert('xss')", snippet, StringComparison.Ordinal);
        Assert.DoesNotContain("&lt;", snippet, StringComparison.Ordinal);
    }
}
