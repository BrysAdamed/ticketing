using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

/// <summary>I-30, D-94: rapid changes by the same actor on the same ticket within 5 minutes become one notification.</summary>
[Collection(nameof(NotificationsCollection))]
public sealed class NotificationCollapsingTests(TicketingApiFactory api)
{
    [Fact]
    public async Task Changes_by_the_same_actor_within_five_minutes_collapse_under_the_highest_ranked_headline()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Busy");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.CommentAsync("WEB-1");
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { status = "InProgress" });
        await world.OwnerClient.CommentAsync("WEB-1");
        var page = await world.MemberClient.NotificationsAsync();

        // Assert
        var item = Assert.Single(page.Items);
        Assert.Equal((NotificationKind.StatusChanged, "changed the status from To Do to In Progress", 3), (item.Kind, item.Summary, item.EventCount));
        Assert.True(item.UpdatedAt >= item.CreatedAt);
        Assert.Equal(1, await world.MemberClient.UnreadCountAsync());
    }

    [Fact]
    public async Task Several_changes_in_one_save_collapse_too()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "One patch");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "Highest", status = "Review", assignee = world.Member.Email });

        // Assert
        var notification = Assert.Single(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal((NotificationKind.Assigned, 3), (notification.Kind, notification.EventCount));
    }

    [Fact]
    public async Task Different_actors_and_different_tickets_get_their_own_notifications()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "First");
        await world.OwnerClient.CreateTicketAsync("WEB", "Second");
        await world.ViewerClient.WatchAsync("WEB-1");
        await world.ViewerClient.WatchAsync("WEB-2");

        // Act
        await world.OwnerClient.CommentAsync("WEB-1");
        await world.MemberClient.CommentAsync("WEB-1");
        await world.OwnerClient.CommentAsync("WEB-2");

        // Assert
        var notifications = await api.StoredNotificationsAsync(world.Viewer);
        Assert.Equal(3, notifications.Count);
        Assert.All(notifications, n => Assert.Equal(1, n.EventCount));
    }

    [Fact]
    public async Task A_change_more_than_five_minutes_after_the_first_starts_a_new_notification()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Slow");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.OwnerClient.CommentAsync("WEB-1");
        await api.AgeNotificationsAsync(TimeSpan.FromMinutes(4));
        await world.OwnerClient.CommentAsync("WEB-1");

        // Act
        await api.AgeNotificationsAsync(TimeSpan.FromMinutes(2));
        await world.OwnerClient.CommentAsync("WEB-1");

        // Assert
        Assert.Equal([2, 1], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.EventCount));
    }

    [Fact]
    public async Task A_change_after_the_notification_was_read_starts_a_new_one()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Read it");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.OwnerClient.CommentAsync("WEB-1");
        (await world.MemberClient.MarkReadAsync(new { all = true })).EnsureSuccessStatusCode();

        // Act
        await world.OwnerClient.CommentAsync("WEB-1");

        // Assert
        var notifications = await api.StoredNotificationsAsync(world.Member);
        Assert.Equal(2, notifications.Count);
        Assert.NotNull(notifications[0].ReadAt);
        Assert.Null(notifications[1].ReadAt);
        Assert.Equal(1, await world.MemberClient.UnreadCountAsync());
    }

    [Fact]
    public async Task An_assignment_merged_with_watcher_events_of_another_recipient_stays_separate()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var second = await api.CreateUserAsync();
        await api.AddMemberAsync(world.ProjectId, second, ProjectRole.Member);
        await world.OwnerClient.CreateTicketAsync("WEB", "Shared");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { assignee = second.Email, status = "InProgress" });

        // Assert
        Assert.Equal([NotificationKind.StatusChanged], (await api.StoredNotificationsAsync(world.Member)).Select(n => n.Kind));
        var assignee = Assert.Single(await api.StoredNotificationsAsync(second));
        Assert.Equal((NotificationKind.Assigned, 2), (assignee.Kind, assignee.EventCount));
    }
}
