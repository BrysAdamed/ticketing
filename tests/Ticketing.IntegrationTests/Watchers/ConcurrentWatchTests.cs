using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ticketing.Application.Comments;
using Ticketing.Domain.Activity;
using Ticketing.Domain.Collaboration;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Watchers;

/// <summary>D-159: an auto-watch racing an explicit watch of the same user does not fail the write that triggered it.</summary>
[Collection(nameof(WatchersCollection))]
public sealed class ConcurrentWatchTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_comment_succeeds_while_the_commenter_starts_watching_in_another_transaction()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Racy");
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var explicitWatch = await connection.BeginTransactionAsync(_ct);
        await using (var insert = new NpgsqlCommand(
            "INSERT INTO ticket_watchers (ticket_id, user_id, created_at) VALUES (@ticket, @user, now())", connection, explicitWatch))
        {
            insert.Parameters.AddWithValue("ticket", ticket.Id);
            insert.Parameters.AddWithValue("user", world.Member.Id);
            await insert.ExecuteNonQueryAsync(_ct);
        }

        // Act
        var comment = world.MemberClient.PostAsJsonAsync("/api/v1/tickets/WEB-1/comments", new { body = "Me too" }, _ct);
        await api.UntilSomeoneWaitsAsync(_ct);
        await explicitWatch.CommitAsync(_ct);
        var response = await comment;

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.Created);
        Assert.Equal(WatcherTestData.Sorted(world.Owner, world.Member), await api.StoredWatcherIdsAsync(ticket.Id));
    }

    [Fact]
    public async Task An_auto_watch_of_an_existing_ticket_rolls_back_when_the_write_fails_in_the_database()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        var ticket = await world.OwnerClient.CreateTicketAsync("WEB", "Doomed");
        var now = DateTimeOffset.UtcNow;

        // Act
        var error = await api.WithDbAsync(async db =>
        {
            db.ActivityEntries.Add(ActivityEntry.Create(
                ActivityEntityType.Ticket, ticket.Id, world.ProjectId, world.Member.Id, null, now, AddComment.Action,
                newValueJson: $"{{\"commentId\":\"{Guid.NewGuid()}\"}}"));
            db.Notifications.Add(Notification.AboutTicket(Guid.NewGuid(), world.ProjectId, ticket.Id, null, NotificationKind.Commented, "commented", now));
            return await Record.ExceptionAsync(() => db.SaveChangesAsync(_ct));
        });

        // Assert
        Assert.IsType<DbUpdateException>(error);
        Assert.Equal([world.Owner.Id], await api.StoredWatcherIdsAsync(ticket.Id));
    }
}
