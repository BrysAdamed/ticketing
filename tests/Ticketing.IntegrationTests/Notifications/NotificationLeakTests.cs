using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

/// <summary>Spec 10 and D-94: read access is checked again when listing and counting, and nobody can touch others' notifications.</summary>
[Collection(nameof(NotificationsCollection))]
public sealed class NotificationLeakTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Notifications_of_a_project_you_lost_access_to_vanish_and_return_with_access()
    {
        // Arrange
        var world = await api.SeedWorldAsync("PRIV");
        await world.OwnerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        await world.OwnerClient.CreateTicketAsync("PRIV", "Private", extra: new { assignee = world.Member.Email });
        await world.OwnerClient.CreateTicketAsync("PUB", "Public", extra: new { assignee = world.Member.Email });

        // Act
        var before = await world.MemberClient.NotificationsAsync();
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/PRIV/members/{world.Member.Id}", _ct)).EnsureSuccessStatusCode();
        var removed = await world.MemberClient.NotificationsAsync();
        var removedUnread = await world.MemberClient.NotificationsAsync("?unread=true");
        var removedCount = await world.MemberClient.UnreadCountAsync();
        await api.AddMemberAsync(world.ProjectId, world.Member, ProjectRole.Viewer);
        var restored = await world.MemberClient.NotificationsAsync();

        // Assert
        Assert.Equal(["PUB", "PRIV"], before.Items.Select(n => n.ProjectKey));
        Assert.Equal(["PUB"], removed.Items.Select(n => n.ProjectKey));
        Assert.Equal(["PUB"], removedUnread.Items.Select(n => n.ProjectKey));
        Assert.Equal(1, removedCount);
        Assert.Equal(2, restored.Items.Count);
        Assert.Equal(2, (await api.StoredNotificationsAsync(world.Member)).Count);
    }

    [Fact]
    public async Task Notifications_vanish_when_a_public_project_turns_private_or_is_deleted()
    {
        // Arrange
        var world = await api.SeedWorldAsync("PRIV");
        var outsider = await api.CreateUserAsync();
        var outsiderClient = await api.LoginAsync(outsider);
        await world.OwnerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        await world.OwnerClient.CreateProjectAsync("GONE", ProjectVisibility.Public);
        await world.OwnerClient.CreateTicketAsync("PUB", "Public now");
        await world.OwnerClient.CreateTicketAsync("GONE", "Soon gone");
        await outsiderClient.WatchAsync("PUB-1");
        await outsiderClient.WatchAsync("GONE-1");
        await world.OwnerClient.CommentAsync("PUB-1");
        await world.OwnerClient.CommentAsync("GONE-1");
        var before = await outsiderClient.UnreadCountAsync();

        // Act
        (await world.OwnerClient.PatchAsJsonAsync("/api/v1/projects/PUB", new { visibility = "Private" }, HttpAssertions.Json, _ct)).EnsureSuccessStatusCode();
        await api.WithDbAsync(async db =>
        {
            var gone = await db.Projects.SingleAsync(p => p.Key == "GONE", _ct);
            gone.Archive(world.Owner.Id, DateTimeOffset.UtcNow);
            gone.Delete(world.Owner.Id, DateTimeOffset.UtcNow, "GONE");
            return await db.SaveChangesAsync(_ct);
        });

        // Assert
        Assert.Equal(2, before);
        Assert.Empty((await outsiderClient.NotificationsAsync()).Items);
        Assert.Equal(0, await outsiderClient.UnreadCountAsync());
    }

    [Fact]
    public async Task Admins_see_their_notifications_of_private_projects_they_are_not_member_of()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var adminClient = await api.LoginAsync(admin);
        await world.OwnerClient.CreateTicketAsync("WEB", "Admin watches");
        await adminClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.CommentAsync("WEB-1");

        // Assert
        Assert.Single((await adminClient.NotificationsAsync()).Items);
        Assert.Equal(1, await adminClient.UnreadCountAsync());
    }

    [Fact]
    public async Task Other_users_notification_ids_are_ignored_by_mark_read()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Mine", extra: new { assignee = world.Member.Email });
        await world.MemberClient.CreateTicketAsync("WEB", "Theirs", extra: new { assignee = world.Owner.Email });
        var memberItem = Assert.Single((await world.MemberClient.NotificationsAsync()).Items);
        var ownerItem = Assert.Single((await world.OwnerClient.NotificationsAsync()).Items);

        // Act
        var result = await (await world.MemberClient.MarkReadAsync(new { ids = new[] { ownerItem.Id, Guid.NewGuid() } })).ReadAsync<MarkNotificationsReadResult>();
        var stranger = await api.LoginAsync(await api.CreateUserAsync());
        var strangerResult = await (await stranger.MarkReadAsync(new { all = true })).ReadAsync<MarkNotificationsReadResult>();

        // Assert
        Assert.Equal((1, 0), (result.UnreadCount, strangerResult.UnreadCount));
        Assert.Null((await api.StoredNotificationsAsync(world.Owner)).Single(n => n.Id == ownerItem.Id).ReadAt);
        Assert.Null((await api.StoredNotificationsAsync(world.Member)).Single(n => n.Id == memberItem.Id).ReadAt);
        Assert.Empty((await stranger.NotificationsAsync()).Items);
    }
}
