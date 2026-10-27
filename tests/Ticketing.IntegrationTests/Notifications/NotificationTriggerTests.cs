using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Comments;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Collaboration;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Boards;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Testing;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

/// <summary>I-30, D-94: what notifies whom. The actor is never notified about their own action.</summary>
[Collection(nameof(NotificationsCollection))]
public sealed class NotificationTriggerTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_ticket_created_with_an_assignee_notifies_only_the_assignee()
    {
        // Arrange
        var world = await api.SeedWorldAsync();

        // Act
        await world.OwnerClient.CreateTicketAsync("WEB", "Assigned at birth", extra: new { assignee = world.Member.Email });
        await world.OwnerClient.CreateTicketAsync("WEB", "Assigned to myself", extra: new { assignee = world.Owner.Email });

        // Assert
        var member = await api.StoredNotificationsAsync(world.Member);
        Assert.Equal([(NotificationKind.Assigned, "assigned the ticket to you")], member.Headlines());
        Assert.Equal((world.Owner.Id, 1), (member[0].ActorId!.Value, member[0].EventCount));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
        Assert.Empty(await api.StoredNotificationsAsync(world.Viewer));
    }

    [Fact]
    public async Task Reassignment_notifies_the_new_assignee_but_not_watchers_or_the_previous_one()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var second = await api.CreateUserAsync(displayName: "Second Sam");
        await TicketTestData.AddMemberAsync(api, world.ProjectId, second, ProjectRole.Member);
        await world.OwnerClient.CreateTicketAsync("WEB", "Hand over", extra: new { assignee = world.Member.Email });
        await world.ViewerClient.WatchAsync("WEB-1");
        await ClearAsync();

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { assignee = second.Email });
        await world.MemberClient.PatchTicketAsync("WEB-1", new { assignee = world.Member.Email });

        // Assert
        Assert.Equal([(NotificationKind.Assigned, "assigned the ticket to you")], (await api.StoredNotificationsAsync(second)).Headlines());
        Assert.Empty(await api.StoredNotificationsAsync(world.Member));
        Assert.Empty(await api.StoredNotificationsAsync(world.Viewer));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
    }

    [Fact]
    public async Task Regression_items_assigned_by_someone_else_notify_the_assignee_but_take_and_record_do_not()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateManualCaseAsync("WEB", "Login");
        await world.OwnerClient.CreateManualCaseAsync("WEB", "Logout");
        await world.OwnerClient.CreateManualCaseAsync("WEB", "Reset password");
        await world.OwnerClient.StartSessionAsync("WEB", new { name = "Release 1.5" });

        // Act
        var assigned = await world.OwnerClient.PostAsJsonAsync(
            "/api/v1/regression-sessions/WEB-R-1/items/WEB-TC-1/assign", new { assignee = world.Member.Email }, HttpAssertions.Json, _ct);
        var taken = await world.MemberClient.TakeAsync("WEB-R-1", "WEB-TC-2");
        var recorded = await world.MemberClient.RecordAsync("WEB-R-1", "WEB-TC-3", "Passed");
        var takenOver = await world.OwnerClient.TakeAsync("WEB-R-1", "WEB-TC-1");

        // Assert
        foreach (var response in new[] { assigned, taken, recorded, takenOver })
            await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var member = Assert.Single(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal((NotificationKind.RegressionItemAssigned, "assigned you WEB-TC-1 in WEB-R-1 (Release 1.5)"), (member.Kind, member.Summary));
        Assert.Equal(("WEB-TC-1", (Guid?)null), (member.TestCaseKey, member.TicketId));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
        var listed = Assert.Single((await world.MemberClient.NotificationsAsync()).Items);
        Assert.Equal("/projects/WEB/regressions/WEB-R-1?item=WEB-TC-1", listed.Url);
        Assert.Equal(("WEB-R-1", "Release 1.5", "WEB-TC-1"), (listed.Regression!.SessionKey, listed.Regression.SessionName, listed.Regression.TestCaseKey));
        Assert.Null(listed.Ticket);
    }

    [Fact]
    public async Task A_comment_notifies_every_watcher_except_its_author()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Discuss");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.ViewerClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.CommentAsync("WEB-1", "A secret plan nobody should read twice");

        // Assert
        Assert.Equal([(NotificationKind.Commented, "commented")], (await api.StoredNotificationsAsync(world.Member)).Headlines());
        Assert.Equal([(NotificationKind.Commented, "commented")], (await api.StoredNotificationsAsync(world.Viewer)).Headlines());
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
    }

    [Fact]
    public async Task A_new_commenter_starts_watching_and_hears_about_the_next_comment()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Thread");

        // Act
        await world.MemberClient.CommentAsync("WEB-1");
        await world.OwnerClient.CommentAsync("WEB-1");

        // Assert
        Assert.Equal([(NotificationKind.Commented, "commented")], (await api.StoredNotificationsAsync(world.Owner)).Headlines());
        Assert.Equal([(NotificationKind.Commented, "commented")], (await api.StoredNotificationsAsync(world.Member)).Headlines());
    }

    [Fact]
    public async Task A_status_change_through_patch_notifies_watchers()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Progress");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { status = "ReadyForTesting" });

        // Assert
        Assert.Equal(
            [(NotificationKind.StatusChanged, "changed the status from To Do to Ready for Testing")],
            (await api.StoredNotificationsAsync(world.Member)).Headlines());
    }

    [Fact]
    public async Task Moving_onto_a_board_column_notifies_once_with_the_status_as_headline()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Plan it");
        await world.MemberClient.WatchAsync("WEB-1");
        var board = await world.OwnerClient.CreateBoardAsync("Sprint 42", "WEB");

        // Act
        await world.OwnerClient.MoveOkAsync(board.Id.ToString(), ["WEB-1"], status: "InProgress");

        // Assert
        var notification = Assert.Single(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal((NotificationKind.StatusChanged, "changed the status from To Do to In Progress", 2), (notification.Kind, notification.Summary, notification.EventCount));
    }

    [Fact]
    public async Task A_column_change_on_the_same_board_is_a_status_change()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Columns");
        var board = await world.OwnerClient.CreateBoardAsync("Sprint 42", "WEB");
        await world.OwnerClient.MoveOkAsync(board.Id.ToString(), ["WEB-1"]);
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.MoveOkAsync(board.Id.ToString(), ["WEB-1"], status: "Review");

        // Assert
        Assert.Equal([(NotificationKind.StatusChanged, "changed the status from To Do to Review")], (await api.StoredNotificationsAsync(world.Member)).Headlines());
    }

    [Fact]
    public async Task Only_raising_the_priority_to_high_or_highest_notifies_watchers()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Urgent?");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "Low" });
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "Medium" });
        var afterLowAndMedium = await api.StoredNotificationsAsync(world.Member);
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "Highest" });
        await ClearAsync();
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "High" });
        var afterLowering = await api.StoredNotificationsAsync(world.Member);
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "Low" });
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { priority = "High" });

        // Assert
        Assert.Empty(afterLowAndMedium);
        Assert.Empty(afterLowering);
        Assert.Equal([(NotificationKind.PriorityRaised, "raised the priority to High")], (await api.StoredNotificationsAsync(world.Member)).Headlines());
    }

    [Fact]
    public async Task Moves_between_backlog_and_boards_notify_watchers_with_the_destination()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Travels");
        await world.MemberClient.WatchAsync("WEB-1");
        var first = await world.OwnerClient.CreateBoardAsync("Sprint 42", "WEB");
        var second = await world.OwnerClient.CreateBoardAsync("Sprint 43", "WEB");
        var summaries = new List<string>();

        // Act
        foreach (var target in new[] { first.Id.ToString(), second.Id.ToString(), "backlog" })
        {
            await world.OwnerClient.MoveOkAsync(target, ["WEB-1"]);
            summaries.AddRange((await api.StoredNotificationsAsync(world.Member)).Select(n => n.Summary));
            await ClearAsync();
        }

        // Assert
        Assert.Equal(["moved the ticket to board Sprint 42", "moved the ticket to board Sprint 43", "moved the ticket to the backlog"], summaries);
    }

    [Fact]
    public async Task Archiving_or_deleting_a_board_notifies_watchers_of_the_tickets_it_moves()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Carried over");
        await world.OwnerClient.CreateTicketAsync("WEB", "Evacuated");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.MemberClient.WatchAsync("WEB-2");
        var archived = await world.OwnerClient.CreateBoardAsync("Sprint 42", "WEB");
        var deleted = await world.OwnerClient.CreateBoardAsync("Sprint 43", "WEB");
        await world.OwnerClient.MoveOkAsync(archived.Id.ToString(), ["WEB-1"]);
        await world.OwnerClient.MoveOkAsync(deleted.Id.ToString(), ["WEB-2"]);
        await ClearAsync();

        // Act
        (await world.OwnerClient.PostAsJsonAsync($"/api/v1/boards/{archived.Id}/archive", new { carryOverTo = "backlog" }, HttpAssertions.Json, _ct)).EnsureSuccessStatusCode();
        (await world.OwnerClient.DeleteAsync($"/api/v1/boards/{deleted.Id}", _ct)).EnsureSuccessStatusCode();

        // Assert
        var notifications = await api.StoredNotificationsAsync(world.Member);
        Assert.Equal(2, notifications.Count);
        Assert.All(notifications, n => Assert.Equal((NotificationKind.Moved, "moved the ticket to the backlog", world.Owner.Id), (n.Kind, n.Summary, n.ActorId!.Value)));
    }

    [Fact]
    public async Task Deleting_a_ticket_notifies_watchers_and_the_list_flags_it()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Doomed");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        (await world.OwnerClient.DeleteAsync("/api/v1/tickets/WEB-1", _ct)).EnsureSuccessStatusCode();
        var listed = await world.MemberClient.NotificationsAsync();

        // Assert
        var item = Assert.Single(listed.Items);
        Assert.Equal((NotificationKind.Deleted, "deleted the ticket"), (item.Kind, item.Summary));
        Assert.Equal(("WEB-1", "Doomed", true), (item.Ticket!.Key, item.Ticket.Title, item.Ticket.Deleted));
        Assert.Empty(await api.StoredNotificationsAsync(world.Owner));
    }

    [Fact]
    public async Task Edits_that_are_not_triggers_notify_nobody()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Quiet");
        await world.MemberClient.WatchAsync("WEB-1");

        // Act
        await world.OwnerClient.PatchTicketAsync("WEB-1", new { title = "Still quiet", description = "More words", labels = new[] { "ui" } });

        // Assert
        Assert.Equal(0, await api.NotificationCountAsync());
    }

    [Fact]
    public async Task Inactive_users_and_users_without_read_access_get_nothing()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var outsider = await api.CreateUserAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Gatekeeping");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.ViewerClient.WatchAsync("WEB-1");
        await api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == world.Member.Id, _ct)).Deactivate(world.Owner.Id, DateTimeOffset.UtcNow);
            db.TicketWatchers.Add(TicketWatcher.Create(ticket.Id, outsider.Id, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync(_ct);
        });
        (await world.OwnerClient.DeleteAsync($"/api/v1/projects/WEB/members/{world.Viewer.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        await world.OwnerClient.CommentAsync("WEB-1");
        await api.ExecuteAsAsync(world.Owner, async sp =>
        {
            var db = sp.GetRequiredService<ITicketingDbContext>();
            var activity = sp.GetRequiredService<IActivityLog>();
            var tracked = await db.Tickets.SingleAsync(t => t.Id == ticket.Id, _ct);
            tracked.AssignTo(outsider.Id);
            activity.RecordChange(ActivityEntityType.Ticket, ticket.Id, world.ProjectId, UpdateTicket.FieldChanged, "assignee", (Guid?)null, (Guid?)outsider.Id);
            return await db.SaveChangesAsync(_ct);
        });

        // Assert
        Assert.Equal(0, await api.NotificationCountAsync());
    }

    [Fact]
    public async Task System_changes_without_an_actor_still_notify_watchers()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Automated");

        // Act
        await api.WithDbAsync(db =>
        {
            db.ActivityEntries.Add(ActivityEntry.Create(
                ActivityEntityType.Ticket, ticket.Id, world.ProjectId, null, null, DateTimeOffset.UtcNow, AddComment.Action,
                newValueJson: $"{{\"commentId\":\"{Guid.NewGuid()}\"}}"));
            return db.SaveChangesAsync(_ct);
        });

        // Assert
        var notification = Assert.Single(await api.StoredNotificationsAsync(world.Owner));
        Assert.Equal((NotificationKind.Commented, (Guid?)null), (notification.Kind, notification.ActorId));
        Assert.Null(Assert.Single((await world.OwnerClient.NotificationsAsync()).Items).Actor);
    }

    private Task ClearAsync() => api.WithDbAsync(db => db.Notifications.ExecuteDeleteAsync(_ct));
}
