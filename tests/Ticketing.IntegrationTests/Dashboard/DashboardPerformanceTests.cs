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
using Ticketing.Application.Dashboard;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Regressions;
using Ticketing.Domain.Tokens;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Dashboard;

[CollectionDefinition(nameof(DashboardPerformanceCollection))]
public sealed class DashboardPerformanceCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>
/// Spec 7 target: the dashboard of a 50 000-ticket project answers in under 500 ms. Seeds two such projects with bulk
/// INSERT ... SELECT, times the endpoint, and prints per-statement timings plus EXPLAIN ANALYZE of every dashboard query.
/// </summary>
[Collection(nameof(DashboardPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class DashboardPerformanceTests(TicketingApiFactory api)
{
    private const int TicketsPerProject = 50_000;
    private const int Epics = 500;
    private const int Runs = 20;
    private static readonly TimeSpan Budget = TimeSpan.FromMilliseconds(500);
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Dashboard_of_a_50k_ticket_project_answers_within_500_ms()
    {
        // Arrange
        var recorder = new CommandRecorder();
        await using var host = api.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.ConfigureDbContext<TicketingDbContext>(o => o.AddInterceptors(recorder))));
        var owner = await api.CreateUserAsync();
        var assignees = new List<Guid>();
        for (var i = 0; i < 30; i++)
            assignees.Add((await api.CreateUserAsync(displayName: $"Dev {i:00}")).Id);
        var seedTime = Stopwatch.StartNew();
        var project = await api.CreateProjectAsync("PERF", owner, ProjectVisibility.Private);
        var noise = await api.CreateProjectAsync("NOISE", owner, ProjectVisibility.Public);
        await SeedTicketsAsync(project, owner.Id, assignees);
        await SeedTicketsAsync(noise, owner.Id, assignees);
        await SeedRegressionsAsync(project, owner);
        await ExecuteAsync("VACUUM ANALYZE");
        seedTime.Stop();
        var client = BearerClient(host, await api.CreatePatAsync(owner, PatScope.ReadOnly));

        // Act
        for (var i = 0; i < 3; i++)
            await GetDashboardAsync(client, null);
        recorder.Clear();
        var timings = new List<double>();
        var versionTimings = new List<double>();
        for (var i = 0; i < Runs; i++)
        {
            timings.Add(await GetDashboardAsync(client, null));
            versionTimings.Add(await GetDashboardAsync(client, "1.3.0"));
        }

        // Assert
        var report = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"Seeded 2 x {TicketsPerProject} tickets + regressions in {seedTime.Elapsed.TotalSeconds:F1} s")
            .AppendLine(Summary("GET dashboard (all versions)", timings))
            .AppendLine(Summary("GET dashboard?version=1.3.0", versionTimings))
            .AppendLine("Per statement (average over all timed requests):");
        foreach (var statement in recorder.Statements.GroupBy(s => s.Sql).OrderByDescending(g => g.Average(s => s.Milliseconds)))
            report.AppendLine(CultureInfo.InvariantCulture, $"  {statement.Average(s => s.Milliseconds),7:F1} ms  {FirstLine(statement.Key)}");
        foreach (var statement in recorder.Statements.Where(s => s.Sql.Contains("tickets", StringComparison.Ordinal) || s.Sql.Contains("regression", StringComparison.Ordinal))
                     .GroupBy(s => s.Sql).SelectMany(g => new[] { g.First(), g.Last() }))
            report.AppendLine().AppendLine(await ExplainAsync(statement));
        TestContext.Current.TestOutputHelper?.WriteLine(report.ToString());
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "dashboard-performance.txt"), report.ToString(), _ct);

        Assert.True(Percentile(timings, 0.95) < Budget.TotalMilliseconds, report.ToString());
        Assert.True(Percentile(versionTimings, 0.95) < Budget.TotalMilliseconds, report.ToString());
    }

    private async Task<double> GetDashboardAsync(HttpClient client, string? version)
    {
        var url = "/api/v1/projects/PERF/dashboard" + (version is null ? string.Empty : "?version=" + version);
        var watch = Stopwatch.StartNew();
        var response = await client.GetAsync(url, _ct);
        var dashboard = await response.ReadAsync<ProjectDashboardDto>(HttpStatusCode.OK);
        watch.Stop();
        Assert.True(dashboard.Totals.OpenTickets > 0);
        return watch.Elapsed.TotalMilliseconds;
    }

    private static HttpClient BearerClient(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }
    private Task SeedTicketsAsync(Guid projectId, Guid ownerId, List<Guid> assignees) =>
        ExecuteAsync(
            """
            INSERT INTO tickets (id, project_id, number, title, type, status, priority, labels, rank, reporter_id,
                                 created_at, created_by_id, updated_at, status_changed_at)
            SELECT gen_random_uuid(), @project, g, 'Epic ' || g, 1, CASE WHEN g % 5 = 0 THEN 8 ELSE 1 + g % 7 END, 1 + g % 5,
                   '{}', 'a0', @owner, now() - interval '700 days', @owner, now() - (g % 60) * interval '1 day', now()
            FROM generate_series(1, @epics) AS g;

            INSERT INTO tickets (id, project_id, number, title, type, status, resolution, priority, severity, story_points,
                                 version, labels, parent_id, rank, assignee_id, reporter_id, created_at, created_by_id,
                                 updated_at, status_changed_at, resolved_at, deleted_at)
            SELECT gen_random_uuid(), @project, s.g, 'Generated ticket ' || s.g, s.type, s.status,
                   CASE WHEN s.status = 8 THEN 1 END, 1 + s.g % 5,
                   CASE WHEN s.type = 5 AND s.g % 4 <> 0 THEN 1 + s.g % 5 END,
                   (ARRAY[NULL, 1, 2, 3, 5, 8, 13])[1 + s.g % 7],
                   CASE WHEN s.g % 10 < 7 THEN '1.' || (s.g % 10) || '.0' END,
                   '{}',
                   CASE WHEN s.g % 10 < 6 THEN (SELECT e.id FROM tickets e WHERE e.project_id = @project AND e.number = 1 + s.g % @epics) END,
                   'a0',
                   CASE WHEN s.g % 5 <> 0 THEN (@assignees)[1 + s.g % array_length(@assignees, 1)] END,
                   @owner, s.created, @owner, s.created + (now() - s.created) * random(), s.created,
                   CASE WHEN s.status = 8 THEN s.created + (now() - s.created) * random() END,
                   CASE WHEN s.g % 100 = 0 THEN now() END
            FROM (
                SELECT g, 2 + g % 4 AS type, CASE WHEN g % 2 = 0 THEN 8 ELSE 1 + g % 7 END AS status,
                       now() - random() * interval '730 days' AS created
                FROM generate_series(@epics + 1, @total) AS g
            ) AS s;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("owner", ownerId),
            new NpgsqlParameter("assignees", assignees.ToArray()),
            new NpgsqlParameter("epics", Epics),
            new NpgsqlParameter("total", TicketsPerProject));

    private async Task SeedRegressionsAsync(Guid projectId, TestUser owner)
    {
        for (var i = 1; i <= 8; i++)
        {
            await api.AddSessionAsync(projectId, "PERF", owner, new SessionSeed(
                i, [.. Enumerable.Repeat(RegressionItemStatus.Passed, 150), .. Enumerable.Repeat(RegressionItemStatus.Failed, 3)])
            {
                AutomaticCases = 150,
                StartedAt = DateTimeOffset.UtcNow.AddDays(-10 + i),
                EndStatus = i < 8 ? RegressionSessionStatus.Completed : RegressionSessionStatus.InProgress,
                BugTicketNumbers = [Epics + i * 2 + 1],
            });
        }
        await api.AddTestCasesAsync(projectId, owner.Id, @new: 50, manual: 200, automatic: 400);
    }

    private async Task ExecuteAsync(string sql, params NpgsqlParameter[] parameters)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var batch = new NpgsqlCommand(sql, connection) { CommandTimeout = 300 };
        batch.Parameters.AddRange(parameters);
        await batch.ExecuteNonQueryAsync(_ct);
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
