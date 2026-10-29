using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Achievements;
using Ticketing.Application.Common;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>
/// <c>GET /me/achievements</c>, <c>GET /me/achievements/unseen</c>, <c>POST /me/achievements/seen</c> and MCP
/// <c>list_my_achievements</c> (spec 15.6): always the caller's own, behind the flag and the opt-out.
/// </summary>
[Collection(nameof(AchievementsCollection))]
public sealed class MyAchievementsTests(TicketingApiFactory api)
{
    private const string Path = "/api/v1/me/achievements";
    private const string Tool = "list_my_achievements";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task While_the_flag_is_off_every_endpoint_is_a_404_the_tool_is_absent_and_no_start_is_stamped()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(other);
        var client = await api.LoginAsync(user);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var list = await client.GetAsync(Path, _ct);
        var unseen = await client.GetAsync($"{Path}/unseen", _ct);
        var seen = await client.PostAsJsonAsync($"{Path}/seen", new { ids = new[] { AchievementCatalog.Reporter } }, _ct);
        var tools = await ToolNamesAsync(mcp);
        var called = await mcp.CallToolAsync(Tool, cancellationToken: _ct);

        // Assert
        await list.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        await unseen.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        await seen.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        Assert.DoesNotContain(Tool, tools);
        Assert.Contains("list_notifications", tools);
        Assert.True(called.IsError);
        Assert.Equal(AchievementErrors.Disabled, Payload(called).GetProperty("code").GetString());
        Assert.Null(await StartOfAsync(user));
    }

    [Fact]
    public async Task The_list_is_the_whole_catalogue_in_the_documented_shape_and_the_first_call_stamps_the_start()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        var client = await api.LoginAsync(user);

        // Act
        var json = await (await client.GetAsync(Path, _ct)).ReadAsync<JsonElement>();
        var again = await (await client.GetAsync(Path, _ct)).ReadAsync<JsonElement>();

        // Assert
        Assert.Equal(["startedAt", "items"], json.EnumerateObject().Select(p => p.Name));
        var start = await StartOfAsync(user);
        Assert.NotNull(start);
        Assert.Equal(start, json.GetProperty("startedAt").GetDateTimeOffset());
        Assert.Equal(start, again.GetProperty("startedAt").GetDateTimeOffset());
        var items = json.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(AchievementCatalog.All.Select(a => a.Id), items.Select(i => i.GetProperty("id").GetString()));
        var reporter = items[0];
        Assert.Equal(
            ["id", "name", "description", "howToEarn", "icon", "secret", "masked", "tier", "shared", "tiers", "progress"],
            reporter.EnumerateObject().Select(p => p.Name));
        Assert.Equal(["tier", "threshold", "unlockedAt", "seenAt"], reporter.GetProperty("tiers")[0].EnumerateObject().Select(p => p.Name));
        Assert.Equal(["count", "nextTier", "nextThreshold"], reporter.GetProperty("progress").EnumerateObject().Select(p => p.Name));
        Assert.Equal("Reporter", reporter.GetProperty("name").GetString());
        Assert.Equal("file-plus", reporter.GetProperty("icon").GetString());
        Assert.Equal([1, 10, 50, 250], reporter.GetProperty("tiers").EnumerateArray().Select(t => t.GetProperty("threshold").GetInt32()));
        Assert.All(items.Where(i => !i.GetProperty("secret").GetBoolean()), i =>
        {
            Assert.False(string.IsNullOrWhiteSpace(i.GetProperty("howToEarn").GetString()));
            Assert.False(i.GetProperty("masked").GetBoolean());
        });
    }

    [Fact]
    public async Task Earned_tiers_carry_their_dates_and_progress_is_counted_live_from_the_start()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        var client = await api.LoginAsync(user);
        await client.CreateProjectAsync("WEB");
        await client.CreateTicketAsync("WEB", "Before the start");
        await client.GetAsync(Path, _ct);
        await client.CreateTicketAsync("WEB", "After the start");
        await client.CreateTicketAsync("WEB", "Also after the start");
        var unlockedAt = DateTimeOffset.UtcNow.AddMinutes(-1);
        await SeedAsync(user, (AchievementCatalog.Reporter, 1, unlockedAt), (AchievementCatalog.BoardBuilder, 1, unlockedAt));
        await MarkSeenInDbAsync(user, AchievementCatalog.BoardBuilder);

        // Act
        var items = (await (await client.GetAsync(Path, _ct)).ReadAsync<MyAchievementsDto>()).Items.ToDictionary(i => i.Id!);

        // Assert
        var reporter = items[AchievementCatalog.Reporter];
        Assert.Equal(1, reporter.Tier);
        Assert.Equal(new AchievementProgressDto(2, 2, 10), reporter.Progress);
        Assert.Equal(unlockedAt.ToUnixTimeMilliseconds(), reporter.Tiers[0].UnlockedAt!.Value.ToUnixTimeMilliseconds());
        Assert.Null(reporter.Tiers[0].SeenAt);
        Assert.All(reporter.Tiers.Skip(1), t => Assert.Equal((null, null), (t.UnlockedAt, t.SeenAt)));
        var boardBuilder = items[AchievementCatalog.BoardBuilder];
        Assert.Equal(1, boardBuilder.Tier);
        Assert.NotNull(boardBuilder.Tiers[0].SeenAt);
        Assert.Equal(new AchievementProgressDto(0, null, null), boardBuilder.Progress);
        Assert.Equal(new AchievementProgressDto(0, 1, 1), items[AchievementCatalog.Closer].Progress);
        Assert.Equal(0, items[AchievementCatalog.Closer].Tier);
    }

    [Fact]
    public async Task Unseen_lists_the_callers_unseen_tiers_and_seen_marks_them_keeping_earlier_times()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user, other);
        var client = await api.LoginAsync(user);
        var now = DateTimeOffset.UtcNow;
        await SeedAsync(user,
            (AchievementCatalog.Reporter, 1, now.AddMinutes(-3)),
            (AchievementCatalog.Reporter, 2, now.AddMinutes(-2)),
            (AchievementCatalog.Closer, 1, now.AddMinutes(-1)),
            (AchievementCatalog.BoardBuilder, 1, now.AddMinutes(-4)));
        await MarkSeenInDbAsync(user, AchievementCatalog.BoardBuilder);
        await SeedAsync(other, (AchievementCatalog.Reporter, 1, now));
        var seenBefore = await SeenAtAsync(user, AchievementCatalog.BoardBuilder);

        // Act
        var unseen = await (await client.GetAsync($"{Path}/unseen", _ct)).ReadAsync<JsonElement>();
        var afterSeen = await (await client.PostAsJsonAsync($"{Path}/seen",
            new { ids = new[] { AchievementCatalog.Reporter, AchievementCatalog.BoardBuilder, "no-such-achievement" } }, _ct)).ReadAsync<JsonElement>();
        var list = await (await client.GetAsync(Path, _ct)).ReadAsync<MyAchievementsDto>();

        // Assert
        Assert.Equal(["count", "items"], unseen.EnumerateObject().Select(p => p.Name));
        Assert.Equal(["id", "name", "tier", "icon"], unseen.GetProperty("items")[0].EnumerateObject().Select(p => p.Name));
        var items = unseen.Deserialize<UnseenAchievementsDto>(HttpAssertions.Json)!;
        Assert.Equal(3, items.Count);
        Assert.Equal(
            [new("reporter", "Reporter", 1, "file-plus"), new("reporter", "Reporter", 2, "file-plus"), new UnseenAchievementDto("closer", "Closer", 1, "circle-check")],
            items.Items);
        var remaining = afterSeen.Deserialize<UnseenAchievementsDto>(HttpAssertions.Json)!;
        Assert.Equal(1, remaining.Count);
        Assert.Equal([new UnseenAchievementDto("closer", "Closer", 1, "circle-check")], remaining.Items);
        Assert.All(list.Items.Single(i => i.Id == AchievementCatalog.Reporter).Tiers.Take(2), t => Assert.NotNull(t.SeenAt));
        Assert.Equal(seenBefore, await SeenAtAsync(user, AchievementCatalog.BoardBuilder));
        Assert.Null(await SeenAtAsync(other, AchievementCatalog.Reporter));
    }

    [Fact]
    public async Task Marking_seen_needs_write_scoped_credentials_and_one_to_a_hundred_ids()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await SeedAsync(user, (AchievementCatalog.Reporter, 1, DateTimeOffset.UtcNow));
        var readOnly = await api.CreatePatClientAsync(user, PatScope.ReadOnly);
        var readWrite = await api.CreatePatClientAsync(user);

        // Act
        var unseen = await readOnly.GetAsync($"{Path}/unseen", _ct);
        var refused = await readOnly.PostAsJsonAsync($"{Path}/seen", new { ids = new[] { AchievementCatalog.Reporter } }, _ct);
        var none = await readWrite.PostAsJsonAsync($"{Path}/seen", new { ids = Array.Empty<string>() }, _ct);
        var tooMany = await readWrite.PostAsJsonAsync($"{Path}/seen", new { ids = Enumerable.Range(0, 101).Select(i => $"a-{i}").ToArray() }, _ct);
        var stillUnseen = await SeenAtAsync(user, AchievementCatalog.Reporter);
        var accepted = await readWrite.PostAsJsonAsync($"{Path}/seen", new { ids = new[] { AchievementCatalog.Reporter } }, _ct);

        // Assert
        Assert.Equal(1, (await unseen.ReadAsync<UnseenAchievementsDto>()).Count);
        await refused.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        await none.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        await tooMany.ShouldBeProblemAsync(HttpStatusCode.BadRequest, "validation");
        Assert.Null(stillUnseen);
        Assert.Equal(0, (await accepted.ReadAsync<UnseenAchievementsDto>()).Count);
        Assert.NotNull(await SeenAtAsync(user, AchievementCatalog.Reporter));
    }

    [Fact]
    public async Task A_user_who_opted_out_gets_404_everywhere_and_no_start()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == user.Id, _ct)).OptOutOfAchievements();
            return await db.SaveChangesAsync(_ct);
        });
        var client = await api.LoginAsync(user);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));

        // Act
        var list = await client.GetAsync(Path, _ct);
        var unseen = await client.GetAsync($"{Path}/unseen", _ct);
        var seen = await client.PostAsJsonAsync($"{Path}/seen", new { ids = new[] { AchievementCatalog.Reporter } }, _ct);
        var called = await mcp.CallToolAsync(Tool, cancellationToken: _ct);

        // Assert
        await list.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        await unseen.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        await seen.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        Assert.True(called.IsError);
        Assert.Equal(AchievementErrors.Disabled, Payload(called).GetProperty("code").GetString());
        Assert.Null(await StartOfAsync(user));
    }

    [Fact]
    public async Task No_endpoint_or_tool_returns_or_changes_another_users_achievements_not_even_for_an_admin()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var owner = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(admin, owner);
        await SeedAsync(owner, (AchievementCatalog.Reporter, 1, DateTimeOffset.UtcNow), (AchievementCatalog.Closer, 1, DateTimeOffset.UtcNow));
        var ownerClient = await api.LoginAsync(owner);
        await ownerClient.CreateProjectAsync("WEB");
        await ownerClient.GetAsync(Path, _ct);
        await ownerClient.CreateTicketAsync("WEB", "Counted for the owner only");
        var adminClient = await api.LoginAsync(admin);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(admin));

        // Act
        var list = await (await adminClient.GetAsync(Path, _ct)).ReadAsync<MyAchievementsDto>();
        var unseen = await (await adminClient.GetAsync($"{Path}/unseen", _ct)).ReadAsync<UnseenAchievementsDto>();
        var seen = await (await adminClient.PostAsJsonAsync($"{Path}/seen", new { ids = new[] { AchievementCatalog.Reporter, AchievementCatalog.Closer } }, _ct))
            .ReadAsync<UnseenAchievementsDto>();
        var overMcp = await mcp.CallOkAsync(Tool, []);
        var byUserId = await adminClient.GetAsync($"/api/v1/users/{owner.Id}/achievements", _ct);
        var byQuery = await (await adminClient.GetAsync($"{Path}?userId={owner.Id}", _ct)).ReadAsync<MyAchievementsDto>();

        // Assert
        Assert.All(list.Items, i => Assert.Equal(0, i.Tier));
        Assert.Equal(0, list.Items.Single(i => i.Id == AchievementCatalog.Reporter).Progress!.Count);
        Assert.Equal(0, unseen.Count);
        Assert.Equal(0, seen.Count);
        Assert.All(overMcp.GetProperty("items").EnumerateArray(), i => Assert.Equal(0, i.GetProperty("tier").GetInt32()));
        Assert.Empty((await byUserId.ReadAsync<SharedAchievementsDto>()).Items);
        Assert.All(byQuery.Items, i => Assert.Equal(0, i.Tier));
        Assert.Null(await SeenAtAsync(owner, AchievementCatalog.Reporter));
        Assert.Null(await SeenAtAsync(owner, AchievementCatalog.Closer));
        var ownerList = await (await ownerClient.GetAsync(Path, _ct)).ReadAsync<MyAchievementsDto>();
        Assert.Equal(1, ownerList.Items.Single(i => i.Id == AchievementCatalog.Reporter).Progress!.Count);
    }

    [Fact]
    public async Task The_tool_is_listed_while_the_flag_is_on_and_returns_the_rest_shape_for_a_read_only_token()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await SeedAsync(user, (AchievementCatalog.MachineWhisperer, 1, DateTimeOffset.UtcNow));
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        var client = await api.LoginAsync(user);

        // Act
        var tools = (await mcp.ListToolsAsync(cancellationToken: _ct)).Select(t => t.ProtocolTool).ToList();
        var overMcp = await mcp.CallOkAsync(Tool, []);
        var overRest = await (await client.GetAsync(Path, _ct)).ReadAsync<JsonElement>();

        // Assert
        var tool = Assert.Single(tools, t => t.Name == Tool);
        Assert.True(tool.Annotations?.ReadOnlyHint);
        Assert.Equal(Normalized(overRest), Normalized(overMcp));
        var whisperer = overMcp.GetProperty("items").EnumerateArray().Single(i => i.GetProperty("id").GetString() == AchievementCatalog.MachineWhisperer);
        Assert.Equal(1, whisperer.GetProperty("tier").GetInt32());
    }

    [Fact]
    public void A_secret_entry_is_masked_until_earned_and_shown_in_full_once_earned()
    {
        // Arrange
        var secret = new AchievementDefinition("hidden-gem", "Hidden gem", "Found the hidden gem.", null, "diamond", [1, 5], secret: true);
        var unlockedAt = DateTimeOffset.UtcNow;

        // Act
        var masked = AchievementDto.From(secret, [], 3, shared: false);
        var earned = AchievementDto.From(secret, [new EarnedTier(1, unlockedAt, null)], 3, shared: false);

        // Assert
        Assert.Equal(
            (null, null, null, null, null, true, true, 0, null),
            (masked.Id, masked.Name, masked.Description, masked.HowToEarn, masked.Icon, masked.Secret, masked.Masked, masked.Tier, masked.Progress));
        Assert.Empty(masked.Tiers);
        Assert.Equal(("hidden-gem", "Hidden gem", "diamond", false, 1), (earned.Id, earned.Name, earned.Icon, earned.Masked, earned.Tier));
        Assert.Null(earned.HowToEarn);
        Assert.Equal(new AchievementProgressDto(3, 2, 5), earned.Progress);
        Assert.Equal([new(1, 1, unlockedAt, null), new AchievementTierDto(2, 5, null, null)], earned.Tiers);
    }

    [Fact]
    public async Task Every_unearned_secret_entry_of_the_catalogue_is_masked_over_rest()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        var client = await api.LoginAsync(user);

        // Act
        var items = (await (await client.GetAsync(Path, _ct)).ReadAsync<MyAchievementsDto>()).Items;

        // Assert
        Assert.Equal(AchievementCatalog.All.Count, items.Count);
        foreach (var (item, definition) in items.Zip(AchievementCatalog.All))
        {
            if (definition.Secret)
                Assert.Equal((null, null, null, null, true, 0, null), (item.Id, item.Name, item.Description, item.Icon, item.Masked, item.Tiers.Count, item.Progress));
            else
                Assert.Equal((definition.Id, definition.HowToEarn, false), (item.Id, item.HowToEarn, item.Masked));
        }
    }

    private Task SeedAsync(TestUser user, params (string Id, int Tier, DateTimeOffset UnlockedAt)[] tiers) =>
        api.WithDbAsync(async db =>
        {
            foreach (var (id, tier, unlockedAt) in tiers)
                db.UserAchievements.Add(UserAchievement.Create(user.Id, id, tier, unlockedAt));
            return await db.SaveChangesAsync(_ct);
        });

    private Task MarkSeenInDbAsync(TestUser user, string achievementId) =>
        api.WithDbAsync(async db =>
        {
            foreach (var row in await db.UserAchievements.Where(a => a.UserId == user.Id && a.AchievementId == achievementId).ToListAsync(_ct))
                row.MarkSeen(DateTimeOffset.UtcNow.AddMinutes(-30));
            return await db.SaveChangesAsync(_ct);
        });

    private Task<DateTimeOffset?> SeenAtAsync(TestUser user, string achievementId) =>
        api.WithDbAsync(db => db.UserAchievements
            .Where(a => a.UserId == user.Id && a.AchievementId == achievementId)
            .OrderBy(a => a.Tier)
            .Select(a => a.SeenAt)
            .FirstAsync(_ct));

    private Task<DateTimeOffset?> StartOfAsync(TestUser user) =>
        api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.AchievementsStartedAt).SingleAsync(_ct));

    private async Task<IReadOnlyList<string>> ToolNamesAsync(McpClient client) =>
        [.. (await client.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name)];

    private static string Normalized(JsonElement json) =>
        JsonSerializer.Serialize(json.Deserialize<MyAchievementsDto>(HttpAssertions.Json), HttpAssertions.Json);

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
