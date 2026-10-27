using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Ticketing.Application.Common;
using Ticketing.Application.Notifications;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Dashboard;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Notifications;

[CollectionDefinition(nameof(NotificationPerformanceCollection))]
public sealed class NotificationPerformanceCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>
/// TKT-7 target: with 100 000 notifications for one user (and 200 000 for others) the first page of the list, of the unread
/// list and the unread count each answer in under 50 ms (p95). Seeds with INSERT ... SELECT and writes timings plus
/// EXPLAIN ANALYZE of every statement to notifications-performance.txt next to the test binaries.
/// </summary>
[Collection(nameof(NotificationPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class NotificationPerformanceTests(TicketingApiFactory api)
{
    private const int RecipientNotifications = 100_000;
    private const int NoiseNotifications = 200_000;
    private const int Runs = 30;
    private static readonly TimeSpan Budget = TimeSpan.FromMilliseconds(50);
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Listing_and_counting_100k_notifications_answers_within_50_ms()
    {
        // Arrange
        var recorder = new CommandRecorder();
        await using var host = api.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.ConfigureDbContext<TicketingDbContext>(o => o.AddInterceptors(recorder))));
        var owner = await api.CreateUserAsync();
        var recipient = await api.CreateUserAsync();
        var others = new List<Guid>();
        for (var i = 0; i < 10; i++)
            others.Add((await api.CreateUserAsync()).Id);
        var seedTime = Stopwatch.StartNew();
        var member = await api.CreateProjectAsync("PERF", owner, ProjectVisibility.Private, (recipient, ProjectRole.Member));
        var open = await api.CreateProjectAsync("PUB", owner, ProjectVisibility.Public);
        var hidden = await api.CreateProjectAsync("HIDDEN", owner, ProjectVisibility.Private);
        await SeedTicketsAsync(member, owner.Id, 1_000);
        await SeedTicketsAsync(open, owner.Id, 1_000);
        await SeedTicketsAsync(hidden, owner.Id, 200);
        await SeedNotificationsAsync([recipient.Id], owner.Id, RecipientNotifications);
        await SeedNotificationsAsync([.. others], owner.Id, NoiseNotifications);
        await ExecuteAsync("VACUUM ANALYZE");
        seedTime.Stop();
        var client = BearerClient(host, await api.CreatePatAsync(recipient, PatScope.ReadOnly));

        // Act
        var firstPage = await ListAsync(client, string.Empty);
        for (var i = 0; i < 3; i++)
        {
            await ListAsync(client, string.Empty);
            await ListAsync(client, "?unread=true");
            await CountAsync(client);
        }
        recorder.Clear();
        var (all, unread, count, next) = (new List<double>(), new List<double>(), new List<double>(), new List<double>());
        for (var i = 0; i < Runs; i++)
        {
            all.Add(await TimeAsync(() => ListAsync(client, string.Empty)));
            unread.Add(await TimeAsync(() => ListAsync(client, "?unread=true")));
            count.Add(await TimeAsync(() => CountAsync(client)));
            next.Add(await TimeAsync(() => ListAsync(client, $"?cursor={firstPage.NextCursor}")));
        }

        // Assert
        var report = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"Seeded {RecipientNotifications} + {NoiseNotifications} notifications in {seedTime.Elapsed.TotalSeconds:F1} s")
            .AppendLine(Summary("GET /me/notifications", all))
            .AppendLine(Summary("GET /me/notifications?unread=true", unread))
            .AppendLine(Summary("GET /me/notifications/unread-count", count))
            .AppendLine(Summary("GET /me/notifications?cursor=<page 2>", next))
            .AppendLine("Per statement (average over all timed requests):");
        foreach (var statement in recorder.Statements.GroupBy(s => s.Sql).OrderByDescending(g => g.Average(s => s.Milliseconds)))
            report.AppendLine(CultureInfo.InvariantCulture, $"  {statement.Average(s => s.Milliseconds),7:F2} ms  {FirstLine(statement.Key)}");
        foreach (var statement in recorder.Statements.Where(s => s.Sql.Contains("notifications", StringComparison.Ordinal)).GroupBy(s => s.Sql).Select(g => g.Last()))
            report.AppendLine().AppendLine(await ExplainAsync(statement));
        TestContext.Current.TestOutputHelper?.WriteLine(report.ToString());
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "notifications-performance.txt"), report.ToString(), _ct);

        Assert.Equal(PageRequest.DefaultLimit, firstPage.Items.Count);
        Assert.DoesNotContain(firstPage.Items, n => n.ProjectKey == "HIDDEN");
        Assert.True(Percentile(all, 0.95) < Budget.TotalMilliseconds, report.ToString());
        Assert.True(Percentile(unread, 0.95) < Budget.TotalMilliseconds, report.ToString());
        Assert.True(Percentile(count, 0.95) < Budget.TotalMilliseconds, report.ToString());
    }

    private async Task<CursorPage<NotificationDto>> ListAsync(HttpClient client, string query) =>
        await (await client.GetAsync("/api/v1/me/notifications" + query, _ct)).ReadAsync<CursorPage<NotificationDto>>(HttpStatusCode.OK);

    private async Task<int> CountAsync(HttpClient client) =>
        (await (await client.GetAsync("/api/v1/me/notifications/unread-count", _ct)).ReadAsync<UnreadNotificationCountDto>(HttpStatusCode.OK)).Count;

    private static async Task<double> TimeAsync<T>(Func<Task<T>> request)
    {
        var watch = Stopwatch.StartNew();
        await request();
        return watch.Elapsed.TotalMilliseconds;
    }

    private static HttpClient BearerClient(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private Task SeedTicketsAsync(Guid projectId, Guid ownerId, int count) =>
        ExecuteAsync(
            """
            INSERT INTO tickets (id, project_id, number, title, type, status, priority, labels, rank, reporter_id,
                                 created_at, created_by_id, updated_at, status_changed_at, deleted_at)
            SELECT gen_random_uuid(), @project, g, 'Generated ticket ' || g, 2, 1 + g % 8, 1 + g % 5, '{}', 'a0', @owner,
                   now(), @owner, now(), now(), CASE WHEN g % 50 = 0 THEN now() END
            FROM generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("owner", ownerId),
            new NpgsqlParameter("count", count));

    private Task SeedNotificationsAsync(Guid[] recipients, Guid actorId, int count) =>
        ExecuteAsync(
            """
            WITH t AS (SELECT array_agg(id ORDER BY id) AS ids, array_agg(project_id ORDER BY id) AS projects, count(*)::int AS n FROM tickets)
            INSERT INTO notifications (id, recipient_id, project_id, ticket_id, actor_id, kind, summary, event_count, created_at, updated_at, read_at)
            SELECT gen_random_uuid(), (@recipients)[1 + g % array_length(@recipients, 1)], t.projects[1 + g % t.n], t.ids[1 + g % t.n], @actor,
                   (ARRAY[1, 3, 4, 5, 6, 7])[1 + g % 6], 'commented', 1 + g % 3, s.at, s.at,
                   CASE WHEN g % 5 = 0 THEN NULL ELSE s.at + interval '1 hour' END
            FROM t, generate_series(1, @count) AS g
            CROSS JOIN LATERAL (SELECT now() - g * (interval '89 days' / @count) AS at) AS s;
            """,
            new NpgsqlParameter("recipients", recipients),
            new NpgsqlParameter("actor", actorId),
            new NpgsqlParameter("count", count));

    private async Task ExecuteAsync(string sql, params NpgsqlParameter[] parameters)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 300 };
        command.Parameters.AddRange(parameters);
        await command.ExecuteNonQueryAsync(_ct);
    }

    private async Task<string> ExplainAsync(RecordedStatement statement)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand("EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) " + statement.Sql, connection);
        foreach (var parameter in statement.Parameters)
            command.Parameters.Add(parameter.Clone());
        var plan = new StringBuilder().AppendLine("EXPLAIN " + FirstLine(statement.Sql));
        await using var reader = await command.ExecuteReaderAsync(_ct);
        while (await reader.ReadAsync(_ct))
            plan.AppendLine("  " + reader.GetString(0));
        return plan.ToString();
    }

    private static string Summary(string label, List<double> timings) =>
        string.Create(CultureInfo.InvariantCulture,
            $"{label}: p50 {Percentile(timings, 0.5):F1} ms, p95 {Percentile(timings, 0.95):F1} ms, max {timings.Max():F1} ms over {timings.Count} runs");

    private static double Percentile(List<double> values, double percentile)
    {
        var sorted = values.Order().ToList();
        return sorted[(int)Math.Ceiling(percentile * sorted.Count) - 1];
    }

    private static string FirstLine(string sql) =>
        string.Join(' ', sql.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(3)) is var head && head.Length > 140 ? head[..140] : head;

    private sealed record RecordedStatement(string Sql, NpgsqlParameter[] Parameters, double Milliseconds);

    private sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<RecordedStatement> _statements = new();

        public IEnumerable<RecordedStatement> Statements => _statements;

        public void Clear() => _statements.Clear();

        public override ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            _statements.Enqueue(new RecordedStatement(
                command.CommandText,
                command.Parameters.Cast<NpgsqlParameter>().Select(p => p.Clone()).ToArray(),
                eventData.Duration.TotalMilliseconds));
            return ValueTask.FromResult(result);
        }
    }
}
