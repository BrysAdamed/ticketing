using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Net.Http.Json;
using System.Text;
using Npgsql;
using Ticketing.Application.Docs;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Docs;

[CollectionDefinition(nameof(DocPerformanceCollection))]
public sealed class DocPerformanceCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>
/// TKT-12 targets: with 5 000 nodes in a project (two comments on every page, TKT-46), the whole tree answers in under 150 ms (p95) and publishing a 100 KB page
/// in under 250 ms (p95). Writes the timings to docs-performance.txt next to the test binaries.
/// </summary>
[Collection(nameof(DocPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class DocPerformanceTests(TicketingApiFactory api)
{
    private const int Folders = 50;
    private const int PagesPerFolder = 99;
    private const int Nodes = Folders + (Folders * PagesPerFolder);
    private const int CommentsPerPage = 2;
    private const int PageSize = 100_000;
    private const int Runs = 30;
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Tree_and_publish_stay_fast_with_5000_nodes_and_100_kb_pages()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("PERF");
        var seedTime = Stopwatch.StartNew();
        for (var f = 0; f < Folders; f++)
        {
            var folder = await client.CreateFolderAsync("PERF", $"Folder {f}");
            await api.PagesAsync(project.Id, folder.Id, owner.Id, f == 0 ? PagesPerFolder - 1 : PagesPerFolder, firstNumber: 100_000 + (f * 1_000), contentLength: 2_000);
        }
        var page = await client.CreatePageAsync("PERF", "Large page", "Folder 0", Content(0));
        await ExecuteAsync($"INSERT INTO comments (id, doc_node_id, author_id, body, created_at) SELECT gen_random_uuid(), n.id, '{owner.Id}', 'Comment', now() FROM doc_nodes n CROSS JOIN generate_series(1, {CommentsPerPage}) WHERE n.project_id = '{project.Id}' AND n.kind = 2");
        await ExecuteAsync("VACUUM ANALYZE");
        seedTime.Stop();
        await client.GetTreeAsync("PERF");

        // Act
        var tree = new List<double>();
        var publish = new List<double>();
        var version = page.Version;
        for (var i = 1; i <= Runs; i++)
        {
            tree.Add(await TimeAsync(async () => (await client.GetTreeAsync("PERF")).Items.Count));
            var current = version;
            publish.Add(await TimeAsync(async () =>
                (await (await client.PatchDocAsync(page.Key, new { content = Content(i), baseVersion = current })).ReadAsync<DocDto>()).Version));
            version++;
        }

        // Assert
        var report = new StringBuilder()
            .AppendLine(CultureInfo.InvariantCulture, $"Seeded {Nodes} nodes in {seedTime.Elapsed.TotalSeconds:F1} s")
            .AppendLine(Summary("GET /projects/PERF/docs/tree", tree))
            .AppendLine(Summary("PATCH /docs/{key} (100 KB content)", publish))
            .ToString();
        TestContext.Current.TestOutputHelper?.WriteLine(report);
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "docs-performance.txt"), report, _ct);
        Assert.Equal(Nodes, (await client.GetTreeAsync("PERF")).Total);
        Assert.Equal(Runs + 1, version);
        Assert.True(Percentile(tree, 0.95) < 150, report);
        Assert.True(Percentile(publish, 0.95) < 250, report);
    }

    private static string Content(int run)
    {
        var text = new StringBuilder(PageSize);
        var line = 0;
        while (text.Length < PageSize - 100)
            text.Append(CultureInfo.InvariantCulture, $"Line {line++} of revision {run}: the quick brown fox jumps over the lazy dog.\n");
        return text.ToString();
    }

    private async Task ExecuteAsync(string sql)
    {
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand(sql, connection) { CommandTimeout = 300 };
        await command.ExecuteNonQueryAsync(_ct);
    }

    private static async Task<double> TimeAsync<T>(Func<Task<T>> request)
    {
        var watch = Stopwatch.StartNew();
        await request();
        return watch.Elapsed.TotalMilliseconds;
    }

    private static string Summary(string label, List<double> timings) =>
        string.Create(CultureInfo.InvariantCulture,
            $"{label}: p50 {Percentile(timings, 0.5):F1} ms, p95 {Percentile(timings, 0.95):F1} ms, max {timings.Max():F1} ms over {timings.Count} runs");

    private static double Percentile(List<double> values, double percentile)
    {
        var sorted = values.Order().ToList();
        return sorted[(int)Math.Ceiling(percentile * sorted.Count) - 1];
    }
}
