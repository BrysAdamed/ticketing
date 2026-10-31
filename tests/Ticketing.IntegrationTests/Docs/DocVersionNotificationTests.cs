using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>New published versions of pages and diagrams notify the doc's watchers (TKT-113, D-173), collapsed per actor for an hour.</summary>
[Collection(nameof(DocsCollection))]
public sealed class DocVersionNotificationTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Publishing_notifies_the_watchers_but_not_the_actor_and_links_to_the_changes_since()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVA");
        var page = await world.OwnerClient.CreatePageAsync("DVA", "Runbook", content: "Step 1");
        await world.MemberClient.WatchDocAsync(page.Key);
        var afterCreate = await api.StoredNotificationsAsync(world.Member);

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "Step 1\nStep 2", baseVersion = 1 })).EnsureSuccessStatusCode();
        var edit = await world.OwnerClient.PostAsJsonAsync(
            $"/api/v1/docs/{page.Key}/edits", new { edits = new[] { new { oldText = "Step 2", newText = "Step 2b" } } }, HttpAssertions.Json, _ct);
        var listed = await world.MemberClient.NotificationsAsync();

        // Assert
        await edit.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Empty(afterCreate);
        Assert.Equal([(NotificationKind.DocUpdated, "published version 2", 2)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
        var item = Assert.Single(listed.Items);
        Assert.Equal((page.Key, world.Owner.Id), (item.Doc!.Key, item.Actor!.Id));
        Assert.Equal($"/p/DVA/docs/{page.Key}/runbook?history=1", item.Url);
    }

    [Fact]
    public async Task Drafts_and_renames_notify_nobody()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVB");
        var page = await world.OwnerClient.CreatePageAsync("DVB", "Notes", content: "v1");
        await world.MemberClient.WatchDocAsync(page.Key);

        // Act
        var draft = await world.OwnerClient.PutAsJsonAsync(
            $"/api/v1/docs/{page.Key}/draft", new { baseVersion = 1, title = "Notes", content = "work in progress" }, HttpAssertions.Json, _ct);
        var rename = await world.OwnerClient.PatchDocAsync(page.Key, new { title = "Notes 2" });

        // Assert
        await draft.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await rename.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
    }

    [Fact]
    public async Task Restoring_a_version_and_publishing_a_diagram_notify_too()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVC");
        var page = await world.OwnerClient.CreatePageAsync("DVC", "Plan", content: "v1");
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();
        var diagram = await world.OwnerClient.CreateDocAsync("DVC", new { kind = "Diagram", diagramFormat = "Mermaid", title = "Flow", content = "flowchart LR\n  a --> b" });
        await world.MemberClient.WatchDocAsync(page.Key);
        await world.MemberClient.WatchDocAsync(diagram.Key);

        // Act
        var restore = await world.OwnerClient.PostAsJsonAsync($"/api/v1/docs/{page.Key}/versions/1/restore", new { }, HttpAssertions.Json, _ct);
        var redraw = await world.OwnerClient.PatchDocAsync(diagram.Key, new { content = "flowchart LR\n  a --> c", baseVersion = 1 });

        // Assert
        await restore.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await redraw.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var stored = await api.StoredNotificationsAsync(world.Member);
        Assert.Equal(
            [(NotificationKind.DocUpdated, "restored version 1 as version 3", 1), (NotificationKind.DocUpdated, "published version 2", 1)],
            stored.Rows());
        Assert.Equal([page.Id, diagram.Id], stored.Select(n => n.DocNodeId!.Value));
        Assert.Equal([3, 2], stored.Select(n => n.DocVersion!.Value));
    }

    [Fact]
    public async Task Versions_by_one_actor_collapse_for_an_hour_and_other_actors_get_their_own()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVD");
        var page = await world.OwnerClient.CreatePageAsync("DVD", "Living", content: "v1");
        await world.ViewerClient.WatchDocAsync(page.Key);

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();
        await api.AgeNotificationsAsync(TimeSpan.FromMinutes(30));
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v3", baseVersion = 2 })).EnsureSuccessStatusCode();
        (await world.MemberClient.PatchDocAsync(page.Key, new { content = "v4", baseVersion = 3 })).EnsureSuccessStatusCode();
        await api.AgeNotificationsAsync(TimeSpan.FromMinutes(31));
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v5", baseVersion = 4 })).EnsureSuccessStatusCode();

        // Assert
        var stored = await api.StoredNotificationsAsync(world.Viewer);
        Assert.Equal(
            [
                (NotificationKind.DocUpdated, "published version 2", 2),
                (NotificationKind.DocUpdated, "published version 4", 1),
                (NotificationKind.DocUpdated, "published version 5", 1),
            ],
            stored.Rows());
        Assert.Equal([world.Owner.Id, world.Member.Id, world.Owner.Id], stored.Select(n => n.ActorId!.Value));
    }

    [Fact]
    public async Task A_read_notification_is_not_reopened_and_a_comment_still_collapses_for_five_minutes_only()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVE");
        var page = await world.OwnerClient.CreatePageAsync("DVE", "Review", content: "v1");
        await world.MemberClient.WatchDocAsync(page.Key);
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();
        (await world.MemberClient.MarkReadAsync(new { all = true })).EnsureSuccessStatusCode();

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v3", baseVersion = 2 })).EnsureSuccessStatusCode();
        await api.AgeNotificationsAsync(TimeSpan.FromMinutes(10));
        await world.OwnerClient.AddDocCommentAsync(page.Key, "Please review v3");

        // Assert
        Assert.Equal(
            [
                (NotificationKind.DocUpdated, "published version 2", 1),
                (NotificationKind.DocUpdated, "published version 3", 1),
                (NotificationKind.Commented, "commented", 1),
            ],
            (await api.StoredNotificationsAsync(world.Member)).Rows());
    }

    [Fact]
    public async Task A_watcher_newly_mentioned_by_the_publish_gets_the_mention_instead()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVF");
        var page = await world.OwnerClient.CreatePageAsync("DVF", "Owners", content: "TBD");
        await world.MemberClient.WatchDocAsync(page.Key);
        await world.ViewerClient.WatchDocAsync(page.Key);

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = $"Owner: {world.Member.Mention()}", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Assert
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you on the page", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Equal([(NotificationKind.DocUpdated, "published version 2", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
    }

    [Fact]
    public async Task The_kind_can_be_muted_and_a_muted_project_silences_it()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVG");
        var page = await world.OwnerClient.CreatePageAsync("DVG", "Noisy", content: "v1");
        await world.MemberClient.WatchDocAsync(page.Key);
        await world.ViewerClient.WatchDocAsync(page.Key);
        (await world.MemberClient.UpdatePreferencesAsync(new { muteKinds = new[] { "DocUpdated" } })).EnsureSuccessStatusCode();
        (await world.ViewerClient.UpdatePreferencesAsync(new { muteProjects = new[] { "DVG" } })).EnsureSuccessStatusCode();
        var preferences = await (await world.MemberClient.GetAsync("/api/v1/me/notification-preferences", _ct)).ReadAsync<NotificationPreferencesDto>();

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();

        // Assert
        Assert.Contains(new NotificationKindPreferenceDto(NotificationKind.DocUpdated, true, false), preferences.Kinds);
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Empty(await api.StoredNotificationsAsync(world.Viewer));
    }

    [Fact]
    public async Task A_watcher_who_lost_access_hears_nothing_and_old_notifications_are_hidden()
    {
        // Arrange
        var world = await api.SeedWorldAsync("DVH");
        var page = await world.OwnerClient.CreatePageAsync("DVH", "Handover", content: "v1");
        await world.MemberClient.WatchDocAsync(page.Key);
        await world.ViewerClient.WatchDocAsync(page.Key);
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v2", baseVersion = 1 })).EnsureSuccessStatusCode();
        await api.AgeNotificationsAsync(TimeSpan.FromHours(2));
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/DVH/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        (await world.OwnerClient.PatchDocAsync(page.Key, new { content = "v3", baseVersion = 2 })).EnsureSuccessStatusCode();
        var listed = await world.MemberClient.NotificationsAsync();

        // Assert
        Assert.Equal([(NotificationKind.DocUpdated, "published version 2", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Empty(listed.Items);
        Assert.Equal(0, await world.MemberClient.UnreadCountAsync());
        Assert.Equal(2, (await api.StoredNotificationsAsync(world.Viewer)).Count);
    }
}
