using Npgsql;

namespace Ticketing.IntegrationTests.Infrastructure;

/// <summary>Lets a race test hold a row in one transaction and release it only once the write under test waits for it.</summary>
public static class LockWaits
{
    public static async Task UntilSomeoneWaitsAsync(this TicketingApiFactory api, CancellationToken cancellationToken)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new NpgsqlCommand(
            "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'", connection);
        var deadline = DateTime.UtcNow + TimeSpan.FromSeconds(15);
        while ((long)(await command.ExecuteScalarAsync(cancellationToken))! == 0)
        {
            if (DateTime.UtcNow > deadline)
                throw new TimeoutException("No session started waiting for a lock.");
            await Task.Delay(25, cancellationToken);
        }
    }
}
