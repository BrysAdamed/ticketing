using System.Diagnostics;
using System.Globalization;
using System.Text;
using Npgsql;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Search;

namespace Ticketing.IntegrationTests.Docs;

/// <summary>
/// TKT-19 target: docs search and quick jump answer in under 150 ms (p95) with 20 000 docs and 200 000 tickets across 20
/// projects. Writes the timings to docs-search-performance.txt next to the test binaries.
/// </summary>
[Collection(nameof(DocPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class DocSearchPerformanceTests(TicketingApiFactory api)
{
    private const int Projects = 20;
    private const int DocsPerProject = 1_000;
    private const int FoldersPerProject = 10;
    private const int TicketsPerProject = 10_000;
    private const int Runs = 20;
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Docs_search_and_quick_jump_stay_fast_with_20000_docs_and_200000_tickets()
    {
        // Arrange
        var me = await api.CreateUserAsync();
        var owner = await api.CreateUserAsync();
        var seedTime = Stopwatch.StartNew();
        for (var i = 0; i < Projects; i++)
        {
            var visibility = i % 4 == 1 ? ProjectVisibility.Public : ProjectVisibility.Private;
            (TestUser, ProjectRole)[] members = i % 4 is 0 or 2 ? [(me, ProjectRole.Member)] : [];
            var projectId = await api.SeedProjectAsync($"DS{i:D2}", owner, visibility, members);
            await api.BulkSeedTicketsAsync(projectId, owner.Id, TicketsPerProject);
            await SeedDocsAsync(projectId, owner.Id);
        }
        await ExecuteAsync("VACUUM ANALYZE");
        seedTime.Stop();
        var client = await api.LoginAsync(me);

        var cases = new (string Name, string Url)[]
        {
            ("newest first, all readable", "/api/v1/docs/search"),
            ("newest first, page 2", "/api/v1/docs/search?cursor={next}"),
            ("common word, relevance", "/api/v1/docs/search?q=lorem"),
            ("rare word, relevance", "/api/v1/docs/search?q=ledger%20runbook"),
            ("partial title", "/api/v1/docs/search?q=webho"),
            ("doc key", "/api/v1/docs/search?q=DS00-D-500"),
            ("folder subtree with text", "/api/v1/docs/search?folder=DS00-D-3&q=payment"),
            ("project and kind", "/api/v1/docs/search?project=DS02&kind=Page"),
            ("quick jump text", "/api/v1/quick-jump?q=checkout"),
            ("quick jump doc key", "/api/v1/quick-jump?q=DS02-D-77"),
        };
        var next = (await (await client.GetAsync("/api/v1/docs/search", _ct)).ReadAsync<Application.Docs.DocSearchPage>()).NextCursor;

        // Act
        var timings = new List<(string Name, List<double> Ms)>();
        foreach (var (name, url) in cases)
        {
            var target = url.Replace("{next}", next, StringComparison.Ordinal);
            (await client.GetAsync(target, _ct)).EnsureSuccessStatusCode();
            var runs = new List<double>();
            for (var run = 0; run < Runs; run++)
            {
                var watch = Stopwatch.StartNew();
                (await client.GetAsync(target, _ct)).EnsureSuccessStatusCode();
                runs.Add(watch.Elapsed.TotalMilliseconds);
            }
            timings.Add((name, runs));
        }

        // Assert
        var report = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"Seeded {Projects * DocsPerProject} docs and {Projects * TicketsPerProject} tickets in {seedTime.Elapsed.TotalSeconds:F1} s");
        foreach (var (name, runs) in timings)
            report.AppendLine(CultureInfo.InvariantCulture, $"{name}: p50 {Percentile(runs, 0.5):F1} ms, p95 {Percentile(runs, 0.95):F1} ms, max {runs.Max():F1} ms");
        TestContext.Current.TestOutputHelper?.WriteLine(report.ToString());
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "docs-search-performance.txt"), report.ToString(), _ct);
        Assert.All(timings, t => Assert.True(Percentile(t.Ms, 0.95) < 150, report.ToString()));
    }

    /// <summary>Folders 1..10 at the root, then pages spread over them with about 1 KB of text each.</summary>
    private async Task SeedDocsAsync(Guid projectId, Guid userId)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO doc_nodes (id, project_id, number, kind, parent_id, rank, title, content, current_version,
                                   created_at, created_by_id, updated_at, updated_by_id)
            SELECT gen_random_uuid(), @project, g, 1, NULL, 'a' || lpad(g::text, 6, '0'), 'Folder ' || g, NULL, 0,
                   now(), @user, now() - make_interval(mins => g), @user
            FROM generate_series(1, @folders) AS g;

            INSERT INTO doc_nodes (id, project_id, number, kind, parent_id, rank, title, content, current_version,
                                   created_at, created_by_id, updated_at, updated_by_id)
            SELECT gen_random_uuid(), @project, g, 2,
                   (SELECT id FROM doc_nodes WHERE project_id = @project AND number = 1 + g % @folders),
                   'a' || lpad(g::text, 6, '0'),
                   initcap((ARRAY['payment','webhook','deploy','ledger','invoice','refund','oauth','cache'])[1 + g % 8]) || ' guide ' || g,
                   repeat('Lorem ipsum dolor sit amet, consectetur adipiscing elit. ', 18) ||
                   'The ' || (ARRAY['payment','webhook','deploy','ledger','invoice','refund','oauth','cache'])[1 + (g / 8) % 8] || ' runbook ' || g || '.',
                   1, now(), @user, now() - make_interval(secs => g), @user
            FROM generate_series(@folders + 1, @docs) AS g;
            """,
            connection) { CommandTimeout = 300 };
        command.Parameters.AddWithValue("project", projectId);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("folders", FoldersPerProject);
        command.Parameters.AddWithValue("docs", DocsPerProject);
        await command.ExecuteNonQueryAsync(_ct);
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 600 };
        await command.ExecuteNonQueryAsync(_ct);
    }

    private static double Percentile(List<double> values, double percentile)
    {
        var sorted = values.Order().ToList();
        return sorted[(int)Math.Ceiling(percentile * sorted.Count) - 1];
    }
}
