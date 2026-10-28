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
using Ticketing.Application.Onboarding;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Dashboard;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Onboarding;

[CollectionDefinition(nameof(OnboardingPerformanceCollection))]
public sealed class OnboardingPerformanceCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>
/// TKT-55 target: <c>GET /me/onboarding</c> answers in under 50 ms (p95) for a user in two 50 000-ticket projects whose
/// checklist is the worst case for its EXISTS queries: 200 000 of their own activity entries that are not status changes,
/// and every ticket, status change, comment and watch of theirs in a private project they cannot read. Writes timings plus
/// EXPLAIN ANALYZE of every statement to onboarding-performance.txt next to the test binaries.
/// </summary>
[Collection(nameof(OnboardingPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class OnboardingPerformanceTests(TicketingApiFactory api)
{
    private const int TicketsPerProject = 50_000;
    private const int HiddenTickets = 500;
    private const int OwnActivity = 200_000;
    private const int NoiseActivity = 300_000;
    private const int NoiseComments = 200_000;
    private const int Runs = 30;
    private static readonly TimeSpan Budget = TimeSpan.FromMilliseconds(50);
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Onboarding_of_a_busy_user_answers_within_50_ms()
    {
        // Arrange
        var recorder = new CommandRecorder();
        await using var host = api.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
            s.ConfigureDbContext<TicketingDbContext>(o => o.AddInterceptors(recorder))));
        var owner = await api.CreateUserAsync();
        var user = await api.CreateUserAsync();
        var others = new List<Guid>();
        for (var i = 0; i < 20; i++)
            others.Add((await api.CreateUserAsync()).Id);
        var seedTime = Stopwatch.StartNew();
        var member = await api.CreateProjectAsync("PERF", owner, ProjectVisibility.Private, (user, ProjectRole.Member));
        var open = await api.CreateProjectAsync("PUB", owner, ProjectVisibility.Public);
        var hidden = await api.CreateProjectAsync("HIDDEN", owner, ProjectVisibility.Private);
        await api.CreateProjectAsync("MINE", user, ProjectVisibility.Private);
        await SeedTicketsAsync(member, owner.Id, TicketsPerProject);
        await SeedTicketsAsync(open, owner.Id, TicketsPerProject);
        await SeedTicketsAsync(hidden, user.Id, HiddenTickets);
        await SeedActivityAsync(member, [user.Id], "title", OwnActivity);
        await SeedActivityAsync(hidden, [user.Id], "status", HiddenTickets);
        await SeedActivityAsync(member, [.. others], "status", NoiseActivity);
        await SeedCommentsAsync(hidden, [user.Id], HiddenTickets);
        await SeedCommentsAsync(member, [.. others], NoiseComments);
        await SeedWatchersAsync(hidden, user.Id);
        await ExecuteAsync("VACUUM ANALYZE");
        seedTime.Stop();
        var client = BearerClient(host, await api.CreatePatAsync(user, PatScope.ReadOnly));

        // Act
        var onboarding = await GetAsync(client);
        for (var i = 0; i < 3; i++)
            await GetAsync(client);
        recorder.Clear();
        var timings = new List<double>();
        for (var i = 0; i < Runs; i++)
        {
            var watch = Stopwatch.StartNew();
            await GetAsync(client);
            timings.Add(watch.Elapsed.TotalMilliseconds);
        }

        // Assert
        var report = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"Seeded 2 x {TicketsPerProject} tickets, {OwnActivity + NoiseActivity} activity entries, {NoiseComments} comments in {seedTime.Elapsed.TotalSeconds:F1} s")
            .AppendLine(Summary("GET /me/onboarding", timings))
            .AppendLine("Per statement (average over all timed requests):");
        foreach (var statement in recorder.Statements.GroupBy(s => s.Sql).OrderByDescending(g => g.Average(s => s.Milliseconds)))
            report.AppendLine(CultureInfo.InvariantCulture, $"  {statement.Average(s => s.Milliseconds),7:F2} ms  {FirstLine(statement.Key)}");
        foreach (var statement in recorder.Statements.GroupBy(s => s.Sql).Select(g => g.Last()))
            report.AppendLine().AppendLine(await ExplainAsync(statement));
        TestContext.Current.TestOutputHelper?.WriteLine(report.ToString());
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "onboarding-performance.txt"), report.ToString(), _ct);

        Assert.True(onboarding.OwnsProjects);
        Assert.All(
            onboarding.Checklist.Where(i => i.Id is not OnboardingChecklistItems.AgentToken and not OnboardingChecklistItems.AgentConnected),
            i => Assert.False(i.Done, i.Id));
        Assert.True(Percentile(timings, 0.95) < Budget.TotalMilliseconds, report.ToString());
    }

    private async Task<OnboardingDto> GetAsync(HttpClient client) =>
        await (await client.GetAsync("/api/v1/me/onboarding", _ct)).ReadAsync<OnboardingDto>(HttpStatusCode.OK);

    private static HttpClient BearerClient(WebApplicationFactory<Program> host, string token)
    {
        var client = host.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private Task SeedTicketsAsync(Guid projectId, Guid reporterId, int count) =>
        ExecuteAsync(
            """
            INSERT INTO tickets (id, project_id, number, title, type, status, priority, labels, rank, reporter_id,
                                 created_at, created_by_id, updated_at, status_changed_at)
            SELECT gen_random_uuid(), @project, g, 'Generated ticket ' || g, 2, 1 + g % 8, 1 + g % 5, '{}', 'a0', @reporter,
                   now(), @reporter, now(), now()
            FROM generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("reporter", reporterId),
            new NpgsqlParameter("count", count));

    private Task SeedActivityAsync(Guid projectId, Guid[] actors, string field, int count) =>
        ExecuteAsync(
            """
            WITH t AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM tickets WHERE project_id = @project)
            INSERT INTO activity_entries (id, entity_type, entity_id, project_id, actor_id, channel, occurred_at, action, field, old_value, new_value)
            SELECT gen_random_uuid(), 1, t.ids[1 + g % t.n], @project, (@actors)[1 + g % array_length(@actors, 1)], 1,
                   now() - g * interval '1 minute', 'ticket.field.changed', @field, '"a"', '"b"'
            FROM t, generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("actors", actors),
            new NpgsqlParameter("field", field),
            new NpgsqlParameter("count", count));

    private Task SeedCommentsAsync(Guid projectId, Guid[] authors, int count) =>
        ExecuteAsync(
            """
            WITH t AS (SELECT array_agg(id ORDER BY id) AS ids, count(*)::int AS n FROM tickets WHERE project_id = @project)
            INSERT INTO comments (id, ticket_id, author_id, body, created_at)
            SELECT gen_random_uuid(), t.ids[1 + g % t.n], (@authors)[1 + g % array_length(@authors, 1)], 'Comment ' || g, now()
            FROM t, generate_series(1, @count) AS g;
            """,
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("authors", authors),
            new NpgsqlParameter("count", count));

    private Task SeedWatchersAsync(Guid projectId, Guid userId) =>
        ExecuteAsync(
            "INSERT INTO ticket_watchers (ticket_id, user_id, created_at) SELECT id, @user, now() FROM tickets WHERE project_id = @project;",
            new NpgsqlParameter("project", projectId),
            new NpgsqlParameter("user", userId));

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
