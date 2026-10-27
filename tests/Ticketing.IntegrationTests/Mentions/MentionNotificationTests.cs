using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Notifications;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Mentions;

/// <summary>D-96: a newly added mention notifies the user once and makes them a watcher; edits without new mentions do not.</summary>
[Collection(nameof(MentionsCollection))]
public sealed class MentionNotificationTests(TicketingApiFactory api)
{
    [Fact]
    public async Task A_mention_in_a_new_comment_notifies_once_and_makes_the_user_a_watcher()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Mention in a comment");

        // Act
        await world.OwnerClient.AddCommentAsync("WEB-1", $"{world.Viewer.Mention()} please check, {world.Viewer.Mention()} again");

        // Assert
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
        Assert.Contains(world.Viewer.Id, await api.StoredWatcherIdsAsync(ticket.Id));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
    }

    [Fact]
    public async Task A_mentioned_watcher_gets_Mentioned_instead_of_Commented_while_other_watchers_get_Commented()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Both kinds");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.ViewerClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.AddCommentAsync("WEB-1", $"Over to you, {world.Member.Mention()}");

        // Assert
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
        Assert.Equal([(NotificationKind.Commented, "commented", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
    }

    [Fact]
    public async Task Editing_a_comment_notifies_only_newly_added_mentions()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Edits");
        var comment = await world.OwnerClient.AddCommentAsync("WEB-1", $"Hi {world.Member.Mention()}");
        await api.ClearNotificationsAsync();

        // Act
        await world.OwnerClient.EditCommentAsync(comment.Id, $"Hi {world.Member.Mention()}, fixed a typo");
        var afterTypo = await api.StoredNotificationsAsync(world.Member);
        await world.OwnerClient.EditCommentAsync(comment.Id, $"Hi {world.Member.Mention()} and {world.Viewer.Mention()}");

        // Assert
        Assert.Empty(afterTypo);
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
    }

    [Fact]
    public async Task Description_mentions_notify_on_create_and_on_edits_that_add_them()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Described", extra: new { description = $"Owner: {world.Member.Mention()}" });
        var memberAfterCreate = await api.StoredNotificationsAsync(world.Member);
        var watchersAfterCreate = await api.StoredWatcherIdsAsync(ticket.Id);
        await api.ClearNotificationsAsync();
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { description = $"Owner: {world.Member.Mention()}\n\nMore detail." });
        var memberAfterEdit = await api.StoredNotificationsAsync(world.Member);
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { description = $"Owner: {world.Member.Mention()}\n\nReview: {world.Viewer.Mention()}" });

        // Assert
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in the description", 1)], memberAfterCreate.Rows());
        Assert.Contains(world.Member.Id, watchersAfterCreate);
        Assert.Empty(memberAfterEdit);
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in the description", 1)], (await api.StoredNotificationsAsync(world.Viewer)).Rows());
    }

    [Fact]
    public async Task Mentioning_yourself_does_nothing()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        await world.OwnerClient.CreateTicketAsync("WEB", "Self", extra: new { description = $"Note to {world.Owner.Mention()}" });
        await world.OwnerClient.AddCommentAsync("WEB-1", $"Reminder for {world.Owner.Mention()}");

        // Assert
        Assert.Equal(0, await api.NotificationCountAsync());
    }

    [Fact]
    public async Task Removing_and_adding_a_mention_again_counts_as_new()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Again", extra: new { description = world.Member.Mention() });
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { description = "nobody" });
        await api.ClearNotificationsAsync();

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { description = world.Member.Mention() });

        // Assert
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in the description", 1)], (await api.StoredNotificationsAsync(world.Member)).Rows());
    }

    [Fact]
    public async Task A_mentioned_assignee_of_a_new_ticket_gets_one_row_headed_Mentioned()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        await world.OwnerClient.CreateTicketAsync(
            "WEB", "Assigned and mentioned", extra: new { assignee = world.Member.Email, description = $"Yours, {world.Member.Mention()}" });

        // Assert
        var row = Assert.Single(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal((NotificationKind.Mentioned, "mentioned you in the description"), (row.Kind, row.Summary));
    }

    [Fact]
    public async Task On_a_public_project_any_active_user_can_be_mentioned()
    {
        // Arrange
        var world = await api.SeedWorldAsync(visibility: ProjectVisibility.Public);
        var passerby = await api.CreateUserAsync(displayName: "Passerby Pat");
        await world.OwnerClient.CreateTicketAsync("WEB", "Open house");

        // Act
        await world.OwnerClient.AddCommentAsync("WEB-1", $"FYI {passerby.Mention()}");

        // Assert
        Assert.Equal([(NotificationKind.Mentioned, "mentioned you in a comment", 1)], (await api.StoredNotificationsAsync(passerby)).Rows());
    }
}
