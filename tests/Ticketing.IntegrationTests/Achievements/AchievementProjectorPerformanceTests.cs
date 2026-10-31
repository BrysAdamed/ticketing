using System.Collections.Concurrent;
using System.Data.Common;
using System.Diagnostics;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Npgsql;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Achievements;
using Ticketing.Domain.Achievements;
using Ticketing.Application.FeatureFlags;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Projects;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Dashboard;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Achievements;

[CollectionDefinition(nameof(AchievementProjectorPerformanceCollection))]
public sealed class AchievementProjectorPerformanceCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>
/// TKT-64 target: one projector cycle finishes within 5 s, a third of the default 15 s interval, on the 50k-ticket dataset in its
/// worst case (10 s for the first cycle of a process, which also compiles its queries). Two 50 000-ticket
/// projects, 30 days of history by every user (tickets, status changes, assignments, comments), and in the cycle window every
/// one of <see cref="Users"/> users wrote an entry of every action a criterion listens to, so every criterion runs for
/// everyone and recounts about 4 000 entries per user. The evaluator's one query dominates. Writes timings, per-statement durations
/// and its EXPLAIN ANALYZE (JIT off, as the evaluator runs it, D-149) to achievement-projector-performance.txt next to the test binaries.
/// </summary>
[Collection(nameof(AchievementProjectorPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class AchievementProjectorPerformanceTests(TicketingApiFactory api)
{
    private const int Users = 100;
    private const int TicketsPerProject = 50_000;
    private const int HistoryActivity = 400_000;
    private const int HistoryComments = 200_000;
    private static readonly TimeSpan Budget = TimeSpan.FromSeconds(5);
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task One_cycle_over_a_busy_window_finishes_within_budget()
    {
        // Arrange
        var recorder = new CommandRecorder();
        await using var host = api.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.ConfigureDbContext<TicketingDbContext>(o => o.AddInterceptors(recorder))));
        var owner = await api.CreateUserAsync();
        var users = new List<Guid>();
        for (var i = 0; i < Users; i++)
            users.Add((await api.CreateUserAsync()).Id);
        var seedTime = Stopwatch.StartNew();
        var first = await api.CreateProjectAsync("PERF", owner, ProjectVisibility.Public);
        var second = await api.CreateProjectAsync("BULK", owner, ProjectVisibility.Public);
        await SeedTicketsAsync(first, [.. users], TicketsPerProject);
        await SeedTicketsAsync(second, [.. users], TicketsPerProject);
        await SeedHistoryAsync(first, [.. users], HistoryActivity);
        await SeedCommentsAsync(first, [.. users], HistoryComments);
        var triggers = api.Services.GetServices<IAchievementCriterion>().SelectMany(c => c.Triggers ?? []).Distinct().ToArray();
        await SeedWindowAsync(first, [.. users], triggers);
        await ExecuteAsync(
            "UPDATE users SET achievements_started_at = now() - interval '31 days' WHERE id = ANY(@users)",
            new NpgsqlParameter("users", users.ToArray()));
        await EnableFlagForEveryoneAsync();
        await ExecuteAsync("VACUUM ANALYZE");
        seedTime.Stop();
        _ = host.Services;

        // Act
        var cold = await TimeAsync(host.Services, p => p.RunCycleAsync(_ct));
        await ExecuteAsync("DELETE FROM user_achievements; DELETE FROM achievement_projector_state;");
        recorder.Clear();
        var cycle = await TimeAsync(host.Services, p => p.RunCycleAsync(_ct));
        var statements = recorder.Snapshot();
        var again = await TimeAsync(host.Services, p => p.RunCycleAsync(_ct));
        var sweep = await TimeAsync(host.Services, p => p.SweepAsync(_ct));

        // Assert
        var report = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"Seeded {Users} users, 2 x {TicketsPerProject} tickets, {HistoryActivity} activity entries, {HistoryComments} comments, {Users} x {triggers.Length} window entries in {seedTime.Elapsed.TotalSeconds:F1} s")
            .AppendLine(CultureInfo.InvariantCulture, $"First cycle of the process (incl. query compilation): {cold.Elapsed.TotalMilliseconds:F0} ms, {cold.Result.Unlocked} tiers unlocked")
            .AppendLine(CultureInfo.InvariantCulture, $"Cycle, worst case: {cycle.Elapsed.TotalMilliseconds:F0} ms, {cycle.Result.Users} users, {cycle.Result.Unlocked} tiers unlocked")
            .AppendLine(CultureInfo.InvariantCulture, $"Same window again: {again.Elapsed.TotalMilliseconds:F0} ms, {again.Result.Unlocked} tiers unlocked")
            .AppendLine(CultureInfo.InvariantCulture, $"Sweep: {sweep.Elapsed.TotalMilliseconds:F0} ms, {sweep.Result.Users} users, {sweep.Result.Unlocked} tiers unlocked")
            .AppendLine("Worst-case cycle per statement:");
        foreach (var statement in statements.OrderByDescending(s => s.Milliseconds))
            report.AppendLine(CultureInfo.InvariantCulture, $"  {statement.Milliseconds,8:F1} ms  {FirstLine(statement.Sql)}");
        report.AppendLine().AppendLine(await ExplainAsync(statements.Where(s => s.Sql.StartsWith("WITH subjects", StringComparison.Ordinal)).MaxBy(s => s.Milliseconds)!));
        TestContext.Current.TestOutputHelper?.WriteLine(report.ToString());
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "achievement-projector-performance.txt"), report.ToString(), _ct);

        Assert.Equal(Users, cycle.Result.Users);
        Assert.Equal(cold.Result.Unlocked, cycle.Result.Unlocked);
        Assert.True(cycle.Result.Unlocked > 0, report.ToString());
        Assert.Equal(0, again.Result.Unlocked);
        Assert.Equal(0, sweep.Result.Unlocked);
        Assert.True(cycle.Elapsed < Budget, report.ToString());
        Assert.True(cold.Elapsed < 2 * Budget, report.ToString());
    }

    private static async Task<(TimeSpan Elapsed, ProjectionResult Result)> TimeAsync(
        IServiceProvider services, Func<AchievementProjection, Task<ProjectionResult>> run)
    {
        await using var scope = services.CreateAsyncScope();
        var projection = scope.ServiceProvider.GetRequiredService<AchievementProjection>();
        var watch = Stopwatch.StartNew();
        var result = await run(projection);
        return (watch.Elapsed, result);
    }

    private Task EnableFlagForEveryoneAsync() =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var flag = FeatureFlag.Register(FeatureFlagCatalog.Achievements.Key, FeatureFlagCatalog.Achievements.Description, true, now);
            flag.Configure(true, 100, [], [], null, now);
            db.FeatureFlags.Add(flag);
            await db.SaveChangesAsync(_ct);
            api.Services.GetRequiredService<IFeatureFlagStore>().Invalidate();
            return true;
        });

    private Task SeedTicketsAsync(Guid projectId, Guid[] reporters, int count) =>
        ExecuteAsync(
            """
            INSERT INTO tickets (id, project_id, number, title, type, status, priority, labels, rank, reporter_id,
                                 created_at, created_by_id, updated_at, status_changed_at)
            SELECT gen_random_uuid(), @project, g, 'Generated ticket ' || g, 1 + g % 5, 1 + g % 8, 1 + g % 5, '{}', 'a0',
                   (@reporters)[1 + g % array_length(@reporters, 1)],
                   now() - (g % 43000) * interval '1 minute', (@reporters)[1 + g % array_length(@reporters, 1)], now(), now()
            FROM generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("reporters", reporters),
            new NpgsqlParameter("count", count));

    private Task SeedHistoryAsync(Guid projectId, Guid[] actors, int count) =>
        ExecuteAsync(
            """
            WITH t AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM tickets WHERE project_id = @project)
            INSERT INTO activity_entries (id, entity_type, entity_id, project_id, actor_id, channel, occurred_at, action, field, old_value, new_value)
            SELECT gen_random_uuid(), 1, t.ids[1 + g % t.n], @project, (@actors)[1 + g % array_length(@actors, 1)], 1,
                   now() - interval '10 minutes' - (g % 43000) * interval '1 minute', 'ticket.field.changed',
                   CASE g % 3 WHEN 0 THEN 'assignee' ELSE 'status' END,
                   '"ToDo"',
                   CASE g % 3 WHEN 0 THEN to_jsonb((@actors)[1 + (g + 1) % array_length(@actors, 1)]::text)
                              WHEN 1 THEN '"Done"'::jsonb ELSE '"Review"'::jsonb END
            FROM t, generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("actors", actors),
            new NpgsqlParameter("count", count));

    private Task SeedCommentsAsync(Guid projectId, Guid[] authors, int count) =>
        ExecuteAsync(
            """
            WITH t AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM tickets WHERE project_id = @project)
            INSERT INTO comments (id, ticket_id, author_id, body, created_at)
            SELECT gen_random_uuid(), t.ids[1 + g % t.n], (@authors)[1 + g % array_length(@authors, 1)], 'Comment ' || g,
                   now() - (g % 43000) * interval '1 minute'
            FROM t, generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("authors", authors),
            new NpgsqlParameter("count", count));

    private Task SeedWindowAsync(Guid projectId, Guid[] actors, string[] actions) =>
        ExecuteAsync(
            """
            WITH t AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM tickets WHERE project_id = @project)
            INSERT INTO activity_entries (id, entity_type, entity_id, project_id, actor_id, channel, occurred_at, action, field, old_value, new_value)
            SELECT gen_random_uuid(), 1, t.ids[1 + (u.i * 31 + a.j) % t.n], @project, u.id, 3, now() - interval '30 seconds', a.action,
                   CASE WHEN a.action = 'ticket.field.changed' THEN 'status' END, NULL,
                   CASE WHEN a.action = 'ticket.field.changed' THEN '"Done"'::jsonb END
            FROM t, unnest(@actors) WITH ORDINALITY AS u(id, i), unnest(@actions) WITH ORDINALITY AS a(action, j);
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("actors", actors),
            new NpgsqlParameter("actions", actions));

    private async Task ExecuteAsync(string sql, params NpgsqlParameter[] parameters)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 600 };
        command.Parameters.AddRange(parameters);
        await command.ExecuteNonQueryAsync(_ct);
    }

    private static string FirstLine(string sql) =>
        string.Join(' ', sql.Split('\n', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).Take(3)) is var head && head.Length > 140 ? head[..140] : head;

    private async Task<string> ExplainAsync(RecordedStatement statement)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using (var jitOff = new NpgsqlCommand("SET jit = off", connection))
            await jitOff.ExecuteNonQueryAsync(_ct);
        await using var command = new NpgsqlCommand("EXPLAIN (ANALYZE, BUFFERS, COSTS OFF) " + statement.Sql, connection);
        foreach (var parameter in statement.Parameters)
            command.Parameters.Add(parameter.Clone());
        var plan = new StringBuilder().AppendLine("EXPLAIN " + FirstLine(statement.Sql));
        await using var reader = await command.ExecuteReaderAsync(_ct);
        while (await reader.ReadAsync(_ct))
            plan.AppendLine("  " + reader.GetString(0));
        return plan.ToString();
    }

    private sealed record RecordedStatement(string Sql, NpgsqlParameter[] Parameters, double Milliseconds);

    private sealed class CommandRecorder : DbCommandInterceptor
    {
        private readonly ConcurrentQueue<RecordedStatement> _statements = new();

        public void Clear() => _statements.Clear();

        public List<RecordedStatement> Snapshot() => [.. _statements];

        public override ValueTask<DbDataReader> ReaderExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, DbDataReader result, CancellationToken cancellationToken = default)
        {
            _statements.Enqueue(new RecordedStatement(
                command.CommandText, [.. command.Parameters.Cast<NpgsqlParameter>().Select(p => p.Clone())], eventData.Duration.TotalMilliseconds));
            return ValueTask.FromResult(result);
        }

        public override ValueTask<int> NonQueryExecutedAsync(
            DbCommand command, CommandExecutedEventData eventData, int result, CancellationToken cancellationToken = default)
        {
            _statements.Enqueue(new RecordedStatement(
                command.CommandText, [.. command.Parameters.Cast<NpgsqlParameter>().Select(p => p.Clone())], eventData.Duration.TotalMilliseconds));
            return ValueTask.FromResult(result);
        }
    }
}
