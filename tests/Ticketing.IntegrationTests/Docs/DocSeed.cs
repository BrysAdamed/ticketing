using Npgsql;
using Ticketing.Domain.Ordering;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>Bulk-inserts doc nodes with SQL, for limit and performance tests (numbers start high so they never meet the counter).</summary>
internal static class DocSeed
{
    public static async Task PagesAsync(
        this TicketingApiFactory api, Guid projectId, Guid? parentId, Guid userId, int count, int firstNumber = 100_000, int contentLength = 0)
    {
        var ranks = FractionalIndex.NKeysBetween(null, null, count).ToArray();
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync();
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO doc_nodes (id, project_id, number, kind, parent_id, rank, title, content, current_version,
                                   created_at, created_by_id, updated_at, updated_by_id)
            SELECT gen_random_uuid(), @project, @first + r.n - 1, 2, @parent, r.rank, 'Seeded page ' || (@first + r.n - 1),
                   left(repeat('Lorem ipsum dolor sit amet ', @length / 27 + 1), @length), 1, now(), @user, now(), @user
            FROM unnest(@ranks) WITH ORDINALITY AS r(rank, n);
            """,
            connection) { CommandTimeout = 300 };
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("parent", (object?)parentId ?? DBNull.Value).NpgsqlDbType = NpgsqlTypes.NpgsqlDbType.Uuid;
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("first", firstNumber);
        command.Parameters.AddWithValue("length", contentLength);
        command.Parameters.AddWithValue("ranks", ranks);
        await command.ExecuteNonQueryAsync();
    }
}
