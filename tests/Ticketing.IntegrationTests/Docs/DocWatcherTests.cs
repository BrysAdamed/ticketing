using System.Net;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Watchers;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Watching pages and diagrams (I-85, D-162): explicit and automatic watchers, and who a doc comment notifies.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocWatcherTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_creator_watches_a_new_page_and_a_commenter_starts_watching()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWA");
        var page = await world.OwnerClient.CreatePageAsync("DWA", "Design");

        // Act
        await world.MemberClient.AddDocCommentAsync(page.Key, "Looks good");
        var watchers = await world.OwnerClient.DocWatchersAsync(page.Key);
        var doc = await world.MemberClient.GetDocAsync(page.Key);
        var folder = await world.OwnerClient.CreateFolderAsync("DWA", "Specs");

        // Assert
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), watchers.Ids().OrderBy(id => id));
        Assert.True(watchers.Watching);
        Assert.Equal((2, true), (doc.Watchers!.Count, doc.Watchers.Watching));
        Assert.Null(folder.Watchers);
        Assert.Empty(await api.WithDbAsync(db => db.DocWatchers.Where(w => w.DocNodeId == folder.Id).ToListAsync()));
    }

    [Fact]
    public async Task A_viewer_can_watch_a_page_and_hears_about_new_comments_until_unwatching()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWB");
        var page = await world.OwnerClient.CreatePageAsync("DWB", "Runbook");

        // Act
        var watched = await world.ViewerClient.WatchDocAsync(page.Key);
        var again = await world.ViewerClient.WatchDocAsync(page.Key);
        await world.MemberClient.AddDocCommentAsync(page.Key, "Updated step 3");
        var unwatched = await world.ViewerClient.UnwatchDocAsync(page.Key);
        await world.MemberClient.AddDocCommentAsync(page.Key, "And step 4");

        // Assert
        Assert.Equal((2, true), (watched.Count, watched.Watching));
        Assert.Equal((2, true), (again.Count, again.Watching));
        Assert.Equal((2, false), (unwatched.Count, unwatched.Watching));
        var viewer = await api.StoredNotificationsAsync(world.Viewer);
        var notified = Assert.Single(viewer);
        Assert.Equal((NotificationKind.Commented, page.Id, world.Member.Id), (notified.Kind, notified.DocNodeId!.Value, notified.ActorId!.Value));
        Assert.Equal(2, (await api.StoredNotificationsAsync(world.Owner)).Sum(n => n.EventCount));
    }

    [Fact]
    public async Task Unwatching_holds_until_the_next_comment_of_ones_own()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWC");
        var page = await world.OwnerClient.CreatePageAsync("DWC", "Plan");
        await world.MemberClient.AddDocCommentAsync(page.Key, "Hi");
        await world.MemberClient.UnwatchDocAsync(page.Key);

        // Act
        await world.OwnerClient.AddDocCommentAsync(page.Key, "Unheard");
        var whileUnwatched = await api.StoredNotificationsAsync(world.Member);
        await world.MemberClient.AddDocCommentAsync(page.Key, "Back");
        await world.OwnerClient.AddDocCommentAsync(page.Key, "Heard");

        // Assert
        Assert.Empty(whileUnwatched);
        Assert.Equal([world.Owner.Id], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.ActorId!.Value));
    }

    [Fact]
    public async Task A_muted_project_silences_doc_comments_for_that_watcher_only()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWD");
        var page = await world.OwnerClient.CreatePageAsync("DWD", "Noisy");
        await world.MemberClient.WatchDocAsync(page.Key);
        await world.ViewerClient.WatchDocAsync(page.Key);
        (await world.MemberClient.UpdatePreferencesAsync(new { muteProjects = new[] { "DWD" } })).EnsureSuccessStatusCode();
        (await world.ViewerClient.UpdatePreferencesAsync(new { muteKinds = new[] { "Commented" } })).EnsureSuccessStatusCode();

        // Act
        await world.OwnerClient.AddDocCommentAsync(page.Key, "Anyone?");

        // Assert
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Empty(await api.StoredNotificationsAsync(world.Viewer));
        Assert.Equal(3, (await api.WithDbAsync(db => db.DocWatchers.Where(w => w.DocNodeId == page.Id).CountAsync())));
    }

    [Fact]
    public async Task A_watcher_who_loses_access_is_hidden_and_not_notified()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWE");
        var page = await world.OwnerClient.CreatePageAsync("DWE", "Handover");
        await world.MemberClient.WatchDocAsync(page.Key);
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/DWE/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        await world.ViewerClient.WatchDocAsync(page.Key);
        var watchers = await world.OwnerClient.DocWatchersAsync(page.Key);
        await world.OwnerClient.AddDocCommentAsync(page.Key, "Welcome");

        // Assert
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Viewer), watchers.Ids().OrderBy(id => id));
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Single(await api.StoredNotificationsAsync(world.Viewer));
        Assert.Equal(3, await api.WithDbAsync(db => db.DocWatchers.Where(w => w.DocNodeId == page.Id).CountAsync()));
    }

    [Fact]
    public async Task Private_docs_are_not_found_for_outsiders_and_folders_cannot_be_watched()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWF");
        var page = await world.OwnerClient.CreatePageAsync("DWF", "Secret");
        var folder = await world.OwnerClient.CreateFolderAsync("DWF", "Box");
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var list = await outsider.GetAsync($"/api/v1/docs/{page.Key}/watchers", _ct);
        var watch = await outsider.PutAsync($"/api/v1/docs/{page.Key}/watchers/me", null, _ct);
        var unwatch = await outsider.DeleteAsync($"/api/v1/docs/{page.Key}/watchers/me", _ct);
        var folderWatch = await world.OwnerClient.PutAsync($"/api/v1/docs/{folder.Key}/watchers/me", null, _ct);

        // Assert
        await list.ShouldBeProblemAsync(HttpStatusCode.NotFound, "doc.notFound");
        await watch.ShouldBeProblemAsync(HttpStatusCode.NotFound, "doc.notFound");
        await unwatch.ShouldBeProblemAsync(HttpStatusCode.NotFound, "doc.notFound");
        await folderWatch.ShouldBeProblemAsync(HttpStatusCode.Conflict, "doc.kind.unsupported");
        Assert.Single(await api.WithDbAsync(db => db.DocWatchers.Where(w => w.DocNodeId == page.Id).ToListAsync()));
    }

    [Fact]
    public async Task Public_projects_let_any_signed_in_user_watch_and_read_only_tokens_cannot()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWG", ProjectVisibility.Public);
        var page = await world.OwnerClient.CreatePageAsync("DWG", "Open");
        var stranger = await api.CreateUserAsync();
        var strangerClient = await api.LoginAsync(stranger);
        var readOnly = await api.CreatePatClientAsync(stranger, PatScope.ReadOnly);

        // Act
        var denied = await readOnly.PutAsync($"/api/v1/docs/{page.Key}/watchers/me", null, _ct);
        var watched = await strangerClient.WatchDocAsync(page.Key);

        // Assert
        await denied.ShouldBeProblemAsync(HttpStatusCode.Forbidden, "pat.readOnlyScope");
        Assert.Equal((2, true), (watched.Count, watched.Watching));
    }

    [Fact]
    public async Task Watch_unwatch_and_get_doc_watchers_over_mcp()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DWH");
        var page = await world.OwnerClient.CreatePageAsync("DWH", "Via MCP");
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Viewer));
        await using var readOnly = await api.CreateMcpClientAsync(await api.CreatePatAsync(world.Viewer, PatScope.ReadOnly));

        // Act
        var watched = await CallAsync(mcp, "watch_doc", new() { ["docKey"] = page.Key });
        var doc = await CallAsync(mcp, "get_doc", new() { ["docKey"] = page.Key });
        var unwatched = await CallAsync(mcp, "unwatch_doc", new() { ["docKey"] = page.Key });
        var hidden = await mcp.CallToolAsync("watch_doc", new Dictionary<string, object?> { ["docKey"] = "NOPE-D-1" }, cancellationToken: _ct);
        var readOnlyTools = (await readOnly.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name).ToList();

        // Assert
        Assert.Equal((2, true), (watched.GetProperty("count").GetInt32(), watched.GetProperty("watching").GetBoolean()));
        Assert.Equal(2, doc.GetProperty("watchers").GetProperty("count").GetInt32());
        Assert.Equal((1, false), (unwatched.GetProperty("count").GetInt32(), unwatched.GetProperty("watching").GetBoolean()));
        Assert.True(hidden.IsError);
        Assert.Contains("doc.notFound", Assert.IsType<TextContentBlock>(hidden.Content[0]).Text, StringComparison.Ordinal);
        Assert.DoesNotContain("watch_doc", readOnlyTools);
        Assert.DoesNotContain("unwatch_doc", readOnlyTools);
    }

    private async Task<JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}

public static class DocWatcherTestData
{
    public static async Task<WatchersDto> DocWatchersAsync(this HttpClient client, string docKey) =>
        await (await client.GetAsync($"/api/v1/docs/{docKey}/watchers")).ReadAsync<WatchersDto>();

    public static async Task<WatchersDto> WatchDocAsync(this HttpClient client, string docKey) =>
        await (await client.PutAsync($"/api/v1/docs/{docKey}/watchers/me", null)).ReadAsync<WatchersDto>();

    public static async Task<WatchersDto> UnwatchDocAsync(this HttpClient client, string docKey) =>
        await (await client.DeleteAsync($"/api/v1/docs/{docKey}/watchers/me")).ReadAsync<WatchersDto>();
}
