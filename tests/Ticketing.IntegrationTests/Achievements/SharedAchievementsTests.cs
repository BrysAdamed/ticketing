using System.Net;
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
/// <c>PUT</c>/<c>DELETE /me/achievements/{id}/share</c>, MCP <c>share_achievement</c>/<c>unshare_achievement</c> and
/// <c>GET /users/{id}/achievements</c> (spec 15.7, D-150): only shared achievements, to every signed-in user, never dates.
/// </summary>
[Collection(nameof(AchievementsCollection))]
public sealed class SharedAchievementsTests(TicketingApiFactory api)
{
    private const string MyPath = "/api/v1/me/achievements";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Sharing_and_unsharing_are_idempotent_and_show_in_my_list()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await SeedAsync(user, (AchievementCatalog.Reporter, 1), (AchievementCatalog.Reporter, 2), (AchievementCatalog.Closer, 1));
        var client = await api.LoginAsync(user);

        // Act
        var shared = await (await client.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ReadAsync<AchievementDto>();
        var firstSharedAt = await SharedAtAsync(user, AchievementCatalog.Reporter);
        var sharedAgain = await (await client.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ReadAsync<AchievementDto>();
        var secondSharedAt = await SharedAtAsync(user, AchievementCatalog.Reporter);
        var list = await (await client.GetAsync(MyPath, _ct)).ReadAsync<MyAchievementsDto>();
        var unshared = await (await client.DeleteAsync(SharePath(AchievementCatalog.Reporter), _ct)).ReadAsync<AchievementDto>();
        var unsharedAgain = await (await client.DeleteAsync(SharePath(AchievementCatalog.Reporter), _ct)).ReadAsync<AchievementDto>();
        var listAfter = await (await client.GetAsync(MyPath, _ct)).ReadAsync<MyAchievementsDto>();

        // Assert
        Assert.Equal((AchievementCatalog.Reporter, 2, true), (shared.Id, shared.Tier, shared.Shared));
        Assert.Equal((AchievementCatalog.Reporter, 2, true), (sharedAgain.Id, sharedAgain.Tier, sharedAgain.Shared));
        Assert.NotNull(firstSharedAt);
        Assert.Equal(firstSharedAt, secondSharedAt);
        Assert.True(list.Items.Single(i => i.Id == AchievementCatalog.Reporter).Shared);
        Assert.All(list.Items.Where(i => i.Id != AchievementCatalog.Reporter), i => Assert.False(i.Shared));
        Assert.False(unshared.Shared);
        Assert.False(unsharedAgain.Shared);
        Assert.All(listAfter.Items, i => Assert.False(i.Shared));
        Assert.Null(await SharedAtAsync(user, AchievementCatalog.Reporter));
    }

    [Fact]
    public async Task Only_earned_achievements_can_be_shared()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await SeedAsync(user, (AchievementCatalog.Reporter, 1));
        var client = await api.LoginAsync(user);

        // Act
        var unearned = await client.PutAsync(SharePath(AchievementCatalog.Closer), null, _ct);
        var unknown = await client.PutAsync(SharePath("no-such-achievement"), null, _ct);
        var unshareUnearned = await client.DeleteAsync(SharePath(AchievementCatalog.Closer), _ct);

        // Assert
        await unearned.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.NotEarned);
        await unknown.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.NotEarned);
        await unshareUnearned.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.NotEarned);
        Assert.Equal(0, await api.WithDbAsync(db => db.UserAchievements.CountAsync(a => a.UserId == user.Id && a.SharedAt != null, _ct)));
    }

    [Fact]
    public async Task A_user_with_no_project_in_common_sees_only_shared_items_at_the_highest_tier_without_dates()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(owner, viewer);
        await SeedAsync(owner, (AchievementCatalog.Reporter, 1), (AchievementCatalog.Closer, 1), (AchievementCatalog.BoardBuilder, 1));
        var ownerClient = await api.LoginAsync(owner);
        await ownerClient.CreateProjectAsync("OWN");
        await (await ownerClient.PutAsync(SharePath(AchievementCatalog.BoardBuilder), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await ownerClient.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await SeedAsync(owner, (AchievementCatalog.Reporter, 2));
        var viewerClient = await api.LoginAsync(viewer);

        // Act
        var response = await viewerClient.GetAsync(UserPath(owner), _ct);
        var raw = await response.Content.ReadAsStringAsync(_ct);
        var json = await response.ReadAsync<JsonElement>();

        // Assert
        Assert.Equal(["items"], json.EnumerateObject().Select(p => p.Name));
        var items = json.GetProperty("items").EnumerateArray().ToList();
        Assert.All(items, i => Assert.Equal(["id", "name", "icon", "tier"], i.EnumerateObject().Select(p => p.Name)));
        Assert.Equal(
            [new(AchievementCatalog.Reporter, "Reporter", "file-plus", 2), new SharedAchievementDto(AchievementCatalog.BoardBuilder, "Board builder", "layout-kanban", 1)],
            json.Deserialize<SharedAchievementsDto>(HttpAssertions.Json)!.Items);
        Assert.DoesNotContain("At\"", raw, StringComparison.Ordinal);
        Assert.DoesNotContain("OWN", raw, StringComparison.Ordinal);
    }

    [Fact]
    public async Task An_admin_sees_no_more_than_anyone_else()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var member = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(owner, admin, member);
        await SeedAsync(owner, (AchievementCatalog.Reporter, 1), (AchievementCatalog.Closer, 1));
        await (await (await api.LoginAsync(owner)).PutAsync(SharePath(AchievementCatalog.Closer), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var asAdmin = await (await (await api.LoginAsync(admin)).GetAsync(UserPath(owner), _ct)).Content.ReadAsStringAsync(_ct);
        var asAdminPat = await (await (await api.CreatePatClientAsync(admin, PatScope.ReadOnly)).GetAsync(UserPath(owner), _ct)).Content.ReadAsStringAsync(_ct);
        var asMember = await (await (await api.LoginAsync(member)).GetAsync(UserPath(owner), _ct)).Content.ReadAsStringAsync(_ct);

        // Assert
        Assert.Equal(asMember, asAdmin);
        Assert.Equal(asMember, asAdminPat);
        var items = JsonSerializer.Deserialize<SharedAchievementsDto>(asMember, HttpAssertions.Json)!.Items;
        Assert.Equal([AchievementCatalog.Closer], items.Select(i => i.Id));
    }

    [Fact]
    public async Task Sharing_needs_write_scoped_credentials_while_reading_shares_does_not()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(user);
        await SeedAsync(user, (AchievementCatalog.Reporter, 1));
        var readOnly = await api.CreatePatClientAsync(user, PatScope.ReadOnly);
        var readWrite = await api.CreatePatClientAsync(user);

        // Act
        var put = await readOnly.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct);
        var notShared = await SharedAtAsync(user, AchievementCatalog.Reporter);
        await (await readWrite.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var delete = await readOnly.DeleteAsync(SharePath(AchievementCatalog.Reporter), _ct);
        var read = await readOnly.GetAsync(UserPath(user), _ct);

        // Assert
        await put.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        await delete.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        Assert.Null(notShared);
        Assert.NotNull(await SharedAtAsync(user, AchievementCatalog.Reporter));
        Assert.Single((await read.ReadAsync<SharedAchievementsDto>()).Items);
    }

    [Fact]
    public async Task With_the_flag_off_for_the_viewer_or_the_owner_the_shares_are_a_404()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(owner);
        await SeedAsync(owner, (AchievementCatalog.Reporter, 1));
        var ownerClient = await api.LoginAsync(owner);
        await (await ownerClient.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var viewerClient = await api.LoginAsync(viewer);

        // Act
        var viewerOff = await viewerClient.GetAsync(UserPath(owner), _ct);
        var viewerOffShare = await viewerClient.PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct);
        await api.SetAchievementsFlagAsync(viewer);
        var ownerOff = await viewerClient.GetAsync(UserPath(owner), _ct);
        var ownerOffOwnView = await ownerClient.GetAsync(UserPath(owner), _ct);

        // Assert
        await viewerOff.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        await viewerOffShare.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        await ownerOff.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
        await ownerOffOwnView.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
    }

    [Fact]
    public async Task Opted_out_deactivated_and_unknown_owners_are_a_404()
    {
        // Arrange
        var optedOut = await api.CreateUserAsync();
        var deactivated = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(optedOut, deactivated, viewer);
        foreach (var owner in new[] { optedOut, deactivated })
        {
            await SeedAsync(owner, (AchievementCatalog.Reporter, 1));
            await (await (await api.LoginAsync(owner)).PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        }
        await api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == optedOut.Id, _ct)).OptOutOfAchievements();
            (await db.Users.SingleAsync(u => u.Id == deactivated.Id, _ct)).Deactivate(viewer.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync(_ct);
        });
        var client = await api.LoginAsync(viewer);

        // Act
        var optedOutResponse = await client.GetAsync(UserPath(optedOut), _ct);
        var deactivatedResponse = await client.GetAsync(UserPath(deactivated), _ct);
        var unknownResponse = await client.GetAsync($"/api/v1/users/{Guid.NewGuid()}/achievements", _ct);

        // Assert
        await optedOutResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
        await deactivatedResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
        await unknownResponse.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
    }

    [Fact]
    public async Task Deleting_the_achievement_rows_on_opt_out_deletes_the_shares()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(owner, viewer);
        await SeedAsync(owner, (AchievementCatalog.Reporter, 1));
        await (await (await api.LoginAsync(owner)).PutAsync(SharePath(AchievementCatalog.Reporter), null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        await api.WithDbAsync(db => db.UserAchievements.Where(a => a.UserId == owner.Id).ExecuteDeleteAsync(_ct));
        var items = await (await (await api.LoginAsync(viewer)).GetAsync(UserPath(owner), _ct)).ReadAsync<SharedAchievementsDto>();

        // Assert
        Assert.Empty(items.Items);
    }

    [Fact]
    public async Task The_share_tools_are_listed_only_with_the_flag_on_and_match_rest()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        await SeedAsync(user, (AchievementCatalog.Reporter, 1));
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));
        await using var readOnlyMcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user, PatScope.ReadOnly));
        var arguments = new Dictionary<string, object?> { ["id"] = AchievementCatalog.Reporter };

        // Act
        var toolsOff = await ToolNamesAsync(mcp);
        await api.SetAchievementsFlagAsync(user);
        var toolsOn = (await mcp.ListToolsAsync(cancellationToken: _ct)).Select(t => t.ProtocolTool).ToList();
        var shared = await mcp.CallOkAsync("share_achievement", arguments);
        var readOnly = await readOnlyMcp.CallToolAsync("unshare_achievement", arguments, cancellationToken: _ct);
        var unearned = await mcp.CallToolAsync("share_achievement", new Dictionary<string, object?> { ["id"] = AchievementCatalog.Closer }, cancellationToken: _ct);
        var unshared = await mcp.CallOkAsync("unshare_achievement", arguments);

        // Assert
        Assert.DoesNotContain("share_achievement", toolsOff);
        Assert.DoesNotContain("unshare_achievement", toolsOff);
        Assert.All(new[] { "share_achievement", "unshare_achievement" }, name =>
        {
            var tool = Assert.Single(toolsOn, t => t.Name == name);
            Assert.False(tool.Annotations?.ReadOnlyHint ?? false);
            Assert.True(tool.Annotations?.IdempotentHint);
        });
        Assert.True(shared.GetProperty("shared").GetBoolean());
        Assert.Equal(AchievementCatalog.Reporter, shared.GetProperty("id").GetString());
        Assert.Equal(AppErrors.ReadOnlyToken, Payload(readOnly).GetProperty("code").GetString());
        Assert.Equal(AchievementErrors.NotEarned, Payload(unearned).GetProperty("code").GetString());
        Assert.False(unshared.GetProperty("shared").GetBoolean());
    }

    private static string SharePath(string id) => $"{MyPath}/{id}/share";

    private static string UserPath(TestUser user) => $"/api/v1/users/{user.Id}/achievements";

    private Task SeedAsync(TestUser user, params (string Id, int Tier)[] tiers) =>
        api.WithDbAsync(async db =>
        {
            foreach (var (id, tier) in tiers)
                db.UserAchievements.Add(UserAchievement.Create(user.Id, id, tier, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync(_ct);
        });

    private Task<DateTimeOffset?> SharedAtAsync(TestUser user, string achievementId) =>
        api.WithDbAsync(db => db.UserAchievements
            .Where(a => a.UserId == user.Id && a.AchievementId == achievementId && a.Tier == 1)
            .Select(a => a.SharedAt)
            .SingleAsync(_ct));

    private async Task<IReadOnlyList<string>> ToolNamesAsync(McpClient client) =>
        [.. (await client.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name)];

    private static JsonElement Payload(CallToolResult result)
    {
        Assert.True(result.IsError);
        return JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}
