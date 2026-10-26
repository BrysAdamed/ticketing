using System.Diagnostics;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ticketing.Application.Common;
using Ticketing.Application.Search;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.Infrastructure.Persistence;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Search;

/// <summary>
/// Search at the spec 10 scale (200 000 tickets, 50 000 in one project). Explicit: run with
/// <c>dotnet test --project tests/Ticketing.IntegrationTests -- --filter-class *SearchPerformanceTests --explicit on</c>.
/// Every query plan (auto_explain, ANALYZE) and timing is written to the test output and to <c>TICKETING_PERF_OUT</c> when set.
/// </summary>
[Collection(nameof(SearchCollection))]
public sealed class SearchPerformanceTests(TicketingApiFactory api)
{
    private const int TotalTickets = 200_000;
    private const int BigProjectTickets = 50_000;
    private const int ProjectCount = 40;
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact(Explicit = true)]
    public async Task Search_queries_stay_fast_at_200k_tickets()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var owner = await api.CreateUserAsync();
        var perProject = (TotalTickets - BigProjectTickets) / (ProjectCount - 1);
        for (var i = 0; i < ProjectCount; i++)
        {
            var key = i == 0 ? "WEB" : $"P{i:D2}";
            var visibility = i % 4 == 1 ? ProjectVisibility.Public : ProjectVisibility.Private;
            (TestUser, ProjectRole)[] members = i % 4 is 0 or 2 ? [(me, ProjectRole.Member)] : [];
            var projectId = await api.SeedProjectAsync(key, owner, visibility, members);
            await api.BulkSeedTicketsAsync(projectId, i % 2 == 0 ? me.Id : owner.Id, i == 0 ? BigProjectTickets : perProject);
        }
        await api.WithDbAsync(db => db.Database.ExecuteSqlRawAsync("ANALYZE", _ct));

        var cases = new (string Name, TestUser User, string Query)[]
        {
            ("default sort, member", me, ""),
            ("default sort, admin", admin, ""),
            ("common word", me, "q=login"),
            ("description word", me, "q=timeout"),
            ("rare partial title", me, "q=" + Uri.EscapeDataString("ticket 12345")),
            ("project open by priority", me, "project=WEB&category=ToDo,InProgress&sort=priority"),
            ("my open work", me, "assignee=me&category=ToDo,InProgress"),
            ("label and type", me, "label=l3&type=Bug"),
            ("key sort", me, "sort=key"),
            ("created range", admin, $"createdFrom={DateTimeOffset.UtcNow.AddDays(-2):yyyy-MM-dd}&sort=created&order=asc"),
            ("rank in backlog", me, "project=WEB&location=backlog&sort=rank"),
        };

        // Act
        var report = new StringBuilder();
        var timings = new List<(string Name, long Ms)>();
        foreach (var (name, user, query) in cases)
            timings.Add((name, await MeasureAsync(report, name, user, sp =>
                sp.GetRequiredService<SearchTickets.Handler>().HandleAsync(new SearchTickets.Query(Parse(query)), _ct))));
        timings.Add(("quick jump", await MeasureAsync(report, "quick jump", me, sp =>
            sp.GetRequiredService<QuickJump.Handler>().HandleAsync(new QuickJump.Query("checkout"), _ct))));
        timings.Add(("my work", await MeasureAsync(report, "my work", me, sp =>
            sp.GetRequiredService<GetMyWork.Handler>().HandleAsync(new GetMyWork.Query(), _ct))));
        timings.Add(("export 10k ids", await MeasureAsync(report, "export", me, async sp =>
        {
            var rows = await sp.GetRequiredService<ExportTickets.Handler>().HandleAsync(new ExportTickets.Query(Parse("project=WEB")), _ct);
            var count = 0;
            await foreach (var _ in rows)
                count++;
            return count;
        })));

        // Assert
        report.Insert(0, string.Join(Environment.NewLine, timings.Select(t => $"{t.Ms,6} ms  {t.Name}")) + Environment.NewLine + Environment.NewLine);
        TestContext.Current.TestOutputHelper?.WriteLine(report.ToString());
        if (Environment.GetEnvironmentVariable("TICKETING_PERF_OUT") is { Length: > 0 } path)
            await File.WriteAllTextAsync(path, report.ToString(), _ct);
        Assert.All(timings.Where(t => t.Name != "export 10k ids"), t => Assert.True(t.Ms < 150, $"{t.Name} took {t.Ms} ms"));
    }

    private static TicketSearchCriteria Parse(string query) =>
        SearchQueryParser.Parse(query.Split('&', StringSplitOptions.RemoveEmptyEntries)
            .Select(p => p.Split('=', 2))
            .GroupBy(p => p[0])
            .ToDictionary(g => g.Key, g => (IReadOnlyList<string?>)[.. g.Select(p => Uri.UnescapeDataString(p[1]))], StringComparer.Ordinal));

    /// <summary>Runs <paramref name="work"/> twice (warm-up, then timed) with auto_explain sending ANALYZE plans as notices.</summary>
    private Task<long> MeasureAsync<T>(StringBuilder report, string name, TestUser user, Func<IServiceProvider, Task<T>> work) =>
        api.ExecuteAsAsync(user, async sp =>
        {
            var db = sp.GetRequiredService<TicketingDbContext>();
            await db.Database.OpenConnectionAsync(_ct);
            await work(sp);
            var plans = new List<string>();
            var connection = (NpgsqlConnection)db.Database.GetDbConnection();
            connection.Notice += (_, e) => plans.Add(e.Notice.MessageText);
            await db.Database.ExecuteSqlRawAsync(
                "LOAD 'auto_explain'; SET auto_explain.log_min_duration = 0; SET auto_explain.log_analyze = on; " +
                "SET auto_explain.log_buffers = on; SET auto_explain.log_level = 'notice'", _ct);
            var stopwatch = Stopwatch.StartNew();
            await work(sp);
            stopwatch.Stop();
            await db.Database.ExecuteSqlRawAsync("SET auto_explain.log_min_duration = -1", _ct);
            report.AppendLine($"=== {name}: {stopwatch.ElapsedMilliseconds} ms (with auto_explain overhead) ===");
            foreach (var plan in plans.Where(p => !p.Contains("auto_explain", StringComparison.Ordinal)))
                report.AppendLine(plan).AppendLine();
            var timed = Stopwatch.StartNew();
            await work(sp);
            return timed.ElapsedMilliseconds;
        });
}
