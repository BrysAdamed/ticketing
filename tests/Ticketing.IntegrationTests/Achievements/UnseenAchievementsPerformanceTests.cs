using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Text;
using Npgsql;
using Ticketing.Application.Achievements;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Achievements;

[CollectionDefinition(nameof(AchievementPerformanceCollection))]
public sealed class AchievementPerformanceCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>
/// TKT-65 target: the unlock toast's poll, <c>GET /me/achievements/unseen</c>, answers in under 50 ms (p95) like the notification
/// unread count (spec 6.16), for a user who earned every tier while 5 000 other users did too. Writes the timings, and those of
/// the full list for comparison, to achievements-performance.txt next to the test binaries.
/// </summary>
[Collection(nameof(AchievementPerformanceCollection))]
[Trait("Category", "Performance")]
public sealed class UnseenAchievementsPerformanceTests(TicketingApiFactory api)
{
    private const int OtherUsers = 5_000;
    private const int Runs = 30;
    private static readonly TimeSpan Budget = TimeSpan.FromMilliseconds(50);
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_unseen_poll_answers_within_50_ms()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await SeedAsync(user.Id);
        var client = api.CreateBearerClient(await api.CreatePatAsync(user, PatScope.ReadOnly));
        for (var i = 0; i < 3; i++)
        {
            await UnseenAsync(client);
            await ListAsync(client);
        }

        // Act
        var (unseen, list) = (new List<double>(), new List<double>());
        UnseenAchievementsDto? result = null;
        for (var i = 0; i < Runs; i++)
        {
            unseen.Add(await TimeAsync(async () => result = await UnseenAsync(client)));
            list.Add(await TimeAsync(() => ListAsync(client)));
        }

        // Assert
        var report = new StringBuilder()
            .AppendLine(Summary("GET /me/achievements/unseen", unseen))
            .AppendLine(Summary("GET /me/achievements", list))
            .ToString();
        TestContext.Current.TestOutputHelper?.WriteLine(report);
        await File.WriteAllTextAsync(Path.Combine(AppContext.BaseDirectory, "achievements-performance.txt"), report, _ct);

        Assert.Equal(AchievementCatalog.All.Sum(a => a.TopTier), result!.Count);
        Assert.True(Percentile(unseen, 0.95) < Budget.TotalMilliseconds, report);
    }

    private async Task SeedAsync(Guid userId)
    {
        var ids = AchievementCatalog.All.SelectMany(a => Enumerable.Range(1, a.TopTier).Select(_ => a.Id)).ToArray();
        var tiers = AchievementCatalog.All.SelectMany(a => Enumerable.Range(1, a.TopTier)).Select(t => (short)t).ToArray();
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var command = new NpgsqlCommand(
            """
            INSERT INTO users
            SELECT (jsonb_populate_record(NULL::users, to_jsonb(u) || jsonb_build_object(
                'id', gen_random_uuid(), 'email', 'noise-' || g || '@ticketing.test', 'achievements_started_at', now()))).*
            FROM users u, generate_series(1, @others) AS g
            WHERE u.id = @user;

            INSERT INTO user_achievements (user_id, achievement_id, tier, unlocked_at, seen_at)
            SELECT u.id, t.achievement_id, t.tier, now() - t.ord * interval '1 minute',
                   CASE WHEN u.id <> @user AND t.ord % 2 = 0 THEN now() END
            FROM users u
            CROSS JOIN unnest(@ids, @tiers) WITH ORDINALITY AS t(achievement_id, tier, ord);
            """,
            connection) { CommandTimeout = 300 };
        command.Parameters.AddWithValue("others", OtherUsers);
        command.Parameters.AddWithValue("user", userId);
        command.Parameters.AddWithValue("ids", ids);
        command.Parameters.AddWithValue("tiers", tiers);
        await command.ExecuteNonQueryAsync(_ct);
        await using var vacuum = new NpgsqlCommand("VACUUM ANALYZE users, user_achievements", connection) { CommandTimeout = 300 };
        await vacuum.ExecuteNonQueryAsync(_ct);
    }

    private async Task<UnseenAchievementsDto> UnseenAsync(HttpClient client) =>
        await (await client.GetAsync("/api/v1/me/achievements/unseen", _ct)).ReadAsync<UnseenAchievementsDto>(HttpStatusCode.OK);

    private async Task<MyAchievementsDto> ListAsync(HttpClient client) =>
        await (await client.GetAsync("/api/v1/me/achievements", _ct)).ReadAsync<MyAchievementsDto>(HttpStatusCode.OK);

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
