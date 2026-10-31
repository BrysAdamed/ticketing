using Npgsql;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;
using Ticketing.IntegrationTests.Watchers;

namespace Ticketing.IntegrationTests.Notifications;

/// <summary>D-159: two writes merging into one notification at the same time both count.</summary>
[Collection(nameof(NotificationsCollection))]
public sealed class ConcurrentMergeTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_merge_waits_for_a_concurrent_merge_into_the_same_notification_and_keeps_its_increment()
    {
        // Arrange
        var world = await api.SeedWorldAsync();
        await world.OwnerClient.CreateTicketAsync("WEB", "Chatty");
        await world.MemberClient.WatchAsync("WEB-1");
        await world.OwnerClient.CommentAsync("WEB-1");
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var concurrentMerge = await connection.BeginTransactionAsync(_ct);
        await using (var update = new NpgsqlCommand(
            "UPDATE notifications SET event_count = event_count + 1 WHERE recipient_id = @recipient", connection, concurrentMerge))
        {
            update.Parameters.AddWithValue("recipient", world.Member.Id);
            Assert.Equal(1, await update.ExecuteNonQueryAsync(_ct));
        }

        // Act
        var comment = world.OwnerClient.CommentAsync("WEB-1");
        await api.UntilSomeoneWaitsAsync(_ct);
        await concurrentMerge.CommitAsync(_ct);
        await comment;

        // Assert
        var notification = Assert.Single(await api.StoredNotificationsAsync(world.Member));
        Assert.Equal(3, notification.EventCount);
    }
}
