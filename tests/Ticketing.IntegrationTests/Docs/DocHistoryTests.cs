using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Attachments;
using Ticketing.Application.Common;
using Ticketing.Application.Docs;
using Ticketing.Application.Projects;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Docs;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Version history, reading an old version and restoring it (spec 1.6, TKT-15) over REST and MCP.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocHistoryTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task History_merges_versions_with_the_activity_no_version_represents()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("HIS");
        var folder = await client.CreateFolderAsync("HIS", "Specs");
        var page = await client.CreatePageAsync("HIS", "Draft", content: "one");
        await client.PatchDocAsync(page.Key, new { title = "Plan" });
        await client.PatchDocAsync(page.Key, new { content = "two", baseVersion = 1, changeNote = "Second" });
        await client.MoveDocAsync(page.Key, new { parent = folder.Key });
        await (await client.UploadDocAttachmentAsync(page.Key, "a.txt", "text/plain", "x"u8.ToArray())).ReadAsync<DocAttachmentDto>(HttpStatusCode.Created);
        await RestoreAsync(client, page.Key, 1);

        // Act
        var history = await HistoryAsync(client, page.Key);
        var folderHistory = await HistoryAsync(client, folder.Key);

        // Assert
        Assert.Equal((page.Key, 3), (history.DocKey, history.CurrentVersion));
        Assert.Equal(
            ["v3", "doc.attachment.added", "doc.moved", "v2", "doc.renamed", "v1"],
            history.Items.Select(i => i.Type == DocHistoryItemType.Version ? $"v{i.Version}" : i.Action!));
        var restored = history.Items[0];
        Assert.Equal(("Draft", 1, WriteChannel.Web), (restored.Title, restored.RestoredFrom, restored.Channel));
        Assert.Equal(("Plan", "Second"), (history.Items[3].Title, history.Items[3].ChangeNote));
        var renamed = history.Items[4];
        Assert.Equal(("title", "Draft", "Plan"), (renamed.Field, renamed.OldValue?.GetString(), renamed.NewValue?.GetString()));
        Assert.NotNull(renamed.Actor);
        Assert.Equal(0, folderHistory.CurrentVersion);
        Assert.Equal([CreateDoc.Action], folderHistory.Items.Select(i => i.Action));
    }

    [Fact]
    public async Task History_pages_with_one_cursor_over_versions_and_activity()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("PAG");
        var page = await client.CreatePageAsync("PAG", "Page", content: "v1");
        for (var version = 1; version < 5; version++)
        {
            await client.PatchDocAsync(page.Key, new { title = $"Page {version}" });
            await client.PatchDocAsync(page.Key, new { content = $"v{version + 1}", baseVersion = version });
        }
        var all = await HistoryAsync(client, page.Key);

        // Act
        var walked = new List<DocHistoryItemDto>();
        string? cursor = null;
        var pages = 0;
        do
        {
            var next = await HistoryAsync(client, page.Key, $"?limit=3{(cursor is null ? "" : $"&cursor={cursor}")}");
            walked.AddRange(next.Items);
            cursor = next.NextCursor;
            pages++;
        }
        while (cursor is not null);
        var invalid = await client.GetAsync($"/api/v1/docs/{page.Key}/history?cursor=nope", _ct);

        // Assert
        Assert.Equal(9, all.Items.Count);
        Assert.Equal(3, pages);
        Assert.Equal(all.Items.Select(i => i.Id), walked.Select(i => i.Id));
        await invalid.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.InvalidCursor);
    }

    [Fact]
    public async Task Get_doc_with_a_version_returns_that_content_and_describes_it()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("OLD");
        var page = await client.CreatePageAsync("OLD", "Page", content: "first");
        await client.PatchDocAsync(page.Key, new { title = "Renamed", content = "second", baseVersion = 1, changeNote = "More" });

        // Act
        var old = await (await client.GetAsync($"/api/v1/docs/{page.Key}?version=1", _ct)).ReadAsync<DocDto>();
        var latest = await client.GetDocAsync(page.Key);
        var missing = await client.GetAsync($"/api/v1/docs/{page.Key}?version=9", _ct);

        // Assert
        Assert.Equal(("first", "Renamed", 2), (old.Content, old.Title, old.Version));
        Assert.Equal((1, "Page", (string?)null), (old.AtVersion!.Number, old.AtVersion.Title, old.AtVersion.ChangeNote));
        Assert.Null(latest.AtVersion);
        Assert.Equal("second", latest.Content);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.VersionNotFound);
    }

    [Fact]
    public async Task Restore_publishes_the_old_title_and_content_as_a_new_version_and_keeps_my_draft()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("RST");
        var page = await client.CreatePageAsync("RST", "Original", content: "first");
        await client.PatchDocAsync(page.Key, new { title = "Changed", content = "second", baseVersion = 1 });
        await (await client.PutAsJsonAsync($"/api/v1/docs/{page.Key}/draft", new { baseVersion = 2, content = "my draft" }, _ct)).ReadAsync<DocDraftDto>();

        // Act
        var restored = await (await client.PostAsJsonAsync($"/api/v1/docs/{page.Key}/versions/1/restore", new { changeNote = "Back" }, _ct)).ReadAsync<DocDto>();
        var again = await (await client.PostAsync($"/api/v1/docs/{page.Key}/versions/1/restore", null, _ct)).ReadAsync<DocDto>();
        var missing = await client.PostAsync($"/api/v1/docs/{page.Key}/versions/7/restore", null, _ct);
        var draft = await client.GetAsync($"/api/v1/docs/{page.Key}/draft", _ct);

        // Assert
        Assert.Equal((3, "Original", "first"), (restored.Version, restored.Title, restored.Content));
        Assert.Equal(3, again.Version);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.VersionNotFound);
        await draft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var version = await api.WithDbAsync(db => db.DocVersions.SingleAsync(v => v.Number == 3, _ct));
        Assert.Equal(("Original", "first", 1, "Back"), (version.Title, version.Content, version.RestoredFrom, version.ChangeNote));
        var actions = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.EntityType == ActivityEntityType.Doc)
            .OrderBy(a => a.OccurredAt)
            .Select(a => new { a.Action, a.NewValue })
            .ToListAsync(_ct));
        Assert.Equal([CreateDoc.Action, UpdateDoc.RenamedAction, DocPublisher.UpdatedAction, DocPublisher.VersionRestoredAction], actions.Select(a => a.Action));
        using var restoredValue = JsonDocument.Parse(actions[^1].NewValue!);
        Assert.Equal((3, 1), (restoredValue.RootElement.GetProperty("version").GetInt32(), restoredValue.RootElement.GetProperty("restoredFrom").GetInt32()));
    }

    [Fact]
    public async Task Restore_fails_for_folders_and_for_a_title_a_sibling_now_holds()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("CLS");
        var folder = await client.CreateFolderAsync("CLS", "Folder");
        var page = await client.CreatePageAsync("CLS", "Name", content: "a");
        await client.PatchDocAsync(page.Key, new { title = "Other", content = "b", baseVersion = 1 });
        await client.CreatePageAsync("CLS", "name");

        // Act
        var onFolder = await client.PostAsync($"/api/v1/docs/{folder.Key}/versions/1/restore", null, _ct);
        var clash = await client.PostAsync($"/api/v1/docs/{page.Key}/versions/1/restore", null, _ct);
        var tooLong = await client.PostAsJsonAsync($"/api/v1/docs/{page.Key}/versions/1/restore", new { changeNote = new string('x', 201) }, _ct);

        // Assert
        await onFolder.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.KindUnsupported);
        await clash.ShouldBeProblemAsync(HttpStatusCode.Conflict, DocErrors.TitleDuplicate);
        await tooLong.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.Equal(2, (await client.GetDocAsync(page.Key)).Version);
    }

    [Fact]
    public async Task Viewers_and_archived_projects_read_history_but_cannot_restore()
    {
        // Arrange
        var ownerUser = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerUser);
        var project = await owner.CreateProjectAsync("VWR");
        var page = await owner.CreatePageAsync("VWR", "Page", content: "a");
        await owner.PatchDocAsync(page.Key, new { content = "b", baseVersion = 1 });
        var viewerUser = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewerUser, ProjectRole.Viewer);
        var viewer = await api.LoginAsync(viewerUser);
        var readOnly = await api.CreatePatClientAsync(ownerUser, PatScope.ReadOnly);

        // Act
        var viewerHistory = await HistoryAsync(viewer, page.Key);
        var viewerOld = await viewer.GetAsync($"/api/v1/docs/{page.Key}?version=1", _ct);
        var viewerRestore = await viewer.PostAsync($"/api/v1/docs/{page.Key}/versions/1/restore", null, _ct);
        var tokenRestore = await readOnly.PostAsync($"/api/v1/docs/{page.Key}/versions/1/restore", null, _ct);
        (await owner.PostAsync("/api/v1/projects/VWR/archive", null, _ct)).EnsureSuccessStatusCode();
        var archivedHistory = await HistoryAsync(owner, page.Key);
        var archivedRestore = await owner.PostAsync($"/api/v1/docs/{page.Key}/versions/1/restore", null, _ct);

        // Assert
        Assert.Equal(2, viewerHistory.Items.Count);
        await viewerOld.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await viewerRestore.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await tokenRestore.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        Assert.Equal(2, archivedHistory.Items.Count);
        await archivedRestore.ShouldBeProblemAsync(HttpStatusCode.Conflict, ProjectErrors.Archived);
        Assert.Equal(2, await api.WithDbAsync(db => db.DocVersions.CountAsync(_ct)));
    }

    [Fact]
    public async Task Outsiders_get_the_same_404_as_for_missing_docs_from_history_versions_and_restore()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("HUSH");
        var page = await owner.CreatePageAsync("HUSH", "Plans", content: "secret");
        var outsiderUser = await api.CreateUserAsync();
        var outsider = await api.LoginAsync(outsiderUser);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsiderUser));

        // Act
        var rest = new[]
        {
            (await outsider.GetAsync($"/api/v1/docs/{page.Key}/history", _ct), await outsider.GetAsync("/api/v1/docs/HUSH-D-999/history", _ct)),
            (await outsider.GetAsync($"/api/v1/docs/{page.Key}?version=1", _ct), await outsider.GetAsync("/api/v1/docs/HUSH-D-999?version=1", _ct)),
            (await outsider.PostAsync($"/api/v1/docs/{page.Key}/versions/1/restore", null, _ct),
                await outsider.PostAsync("/api/v1/docs/HUSH-D-999/versions/1/restore", null, _ct)),
        };
        var tools = new List<(CallToolResult Hidden, CallToolResult Missing)>();
        foreach (var (tool, extra) in new[] { ("get_doc_history", (string?)null), ("get_doc", "version"), ("restore_doc_version", "version") })
        {
            Dictionary<string, object?> Args(string key) => extra is null ? new() { ["docKey"] = key } : new() { ["docKey"] = key, [extra] = 1 };
            tools.Add((await mcp.CallToolAsync(tool, Args(page.Key), cancellationToken: _ct), await mcp.CallToolAsync(tool, Args("HUSH-D-999"), cancellationToken: _ct)));
        }

        // Assert
        foreach (var (hidden, missing) in rest)
        {
            var hiddenBody = await hidden.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
            var missingBody = await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, DocErrors.NotFound);
            Assert.Equal(
                missingBody.GetProperty("title").GetString()!.Replace("HUSH-D-999", page.Key, StringComparison.Ordinal),
                hiddenBody.GetProperty("title").GetString());
        }
        foreach (var (hidden, missing) in tools)
        {
            Assert.Equal(DocErrors.NotFound, Error(hidden).GetProperty("code").GetString());
            Assert.Equal(
                Error(missing).GetProperty("message").GetString()!.Replace("HUSH-D-999", page.Key, StringComparison.Ordinal),
                Error(hidden).GetProperty("message").GetString());
        }
        Assert.Equal(1, await api.WithDbAsync(db => db.DocVersions.CountAsync(_ct)));
    }

    [Fact]
    public async Task An_llm_reads_history_and_an_old_version_and_restores_it_over_mcp()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("MCH");
        var page = await client.CreatePageAsync("MCH", "Page", content: "good");
        await client.PatchDocAsync(page.Key, new { content = "broken", baseVersion = 1, changeNote = "Oops" });
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var history = await CallAsync(mcp, "get_doc_history", new() { ["docKey"] = page.Key });
        var old = await CallAsync(mcp, "get_doc", new() { ["docKey"] = page.Key, ["version"] = 1 });
        var restored = await CallAsync(mcp, "restore_doc_version", new() { ["docKey"] = page.Key, ["version"] = 1, ["changeNote"] = "Undo oops" });

        // Assert
        Assert.Equal(2, history.GetProperty("currentVersion").GetInt32());
        var latest = history.GetProperty("items")[0];
        Assert.Equal(("Version", 2, "Oops"), (latest.GetProperty("type").GetString(), latest.GetProperty("version").GetInt32(), latest.GetProperty("changeNote").GetString()));
        Assert.Equal(("good", 1), (old.GetProperty("content").GetString(), old.GetProperty("atVersion").GetProperty("number").GetInt32()));
        Assert.Equal((3, "good"), (restored.GetProperty("version").GetInt32(), restored.GetProperty("content").GetString()));
        var version = await api.WithDbAsync(db => db.DocVersions.SingleAsync(v => v.Number == 3, _ct));
        Assert.Equal((WriteChannel.Mcp, 1, "Undo oops"), (version.Channel, version.RestoredFrom, version.ChangeNote));
    }

    private async Task<DocHistoryPage> HistoryAsync(HttpClient client, string key, string query = "") =>
        await (await client.GetAsync($"/api/v1/docs/{key}/history{query}", _ct)).ReadAsync<DocHistoryPage>();

    private async Task RestoreAsync(HttpClient client, string key, int number) =>
        await (await client.PostAsync($"/api/v1/docs/{key}/versions/{number}/restore", null, _ct)).ReadAsync<DocDto>();

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        var payload = JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
        Assert.True(result.IsError != true, $"{tool} failed: {payload}");
        return payload;
    }

    private static JsonElement Error(CallToolResult result)
    {
        Assert.True(result.IsError);
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
