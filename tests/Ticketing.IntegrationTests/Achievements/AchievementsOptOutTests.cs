using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Achievements;
using Ticketing.Application.Auth;
using Ticketing.Application.Common;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>Opting out of and back into achievements through <c>PATCH /me</c> (spec 15.11, D-153).</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class AchievementsOptOutTests(TicketingApiFactory api)
{
    private const string MePath = "/api/v1/me";
    private const string MyAchievementsPath = "/api/v1/me/achievements";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Opting_out_deletes_every_tier_and_share_clears_the_start_and_is_idempotent()
    {
        // Arrange
        var world = await WorldAsync();
        var other = await api.CreateUserAsync();
        await api.SetAchievementsFlagAsync(world.Account, other);
        await (await world.Client.GetAsync(MyAchievementsPath, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await SeedAsync(world.Account, (AchievementCatalog.Reporter, 1), (AchievementCatalog.Reporter, 2), (AchievementCatalog.Closer, 1));
        await SeedAsync(other, (AchievementCatalog.Reporter, 1));
        await (await world.Client.PutAsync($"{MyAchievementsPath}/{AchievementCatalog.Reporter}/share", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var otherClient = await api.LoginAsync(other);
        var sharesBefore = await (await otherClient.GetAsync($"/api/v1/users/{world.Account.Id}/achievements", _ct)).ReadAsync<SharedAchievementsDto>();

        // Act
        var optedOut = await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct)).ReadAsync<CurrentUserDto>();
        var again = await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct)).ReadAsync<CurrentUserDto>();
        var me = await (await world.Client.GetAsync(MePath, _ct)).ReadAsync<CurrentUserDto>();
        var sharesAfter = await otherClient.GetAsync($"/api/v1/users/{world.Account.Id}/achievements", _ct);

        // Assert
        Assert.Single(sharesBefore.Items);
        Assert.True(optedOut.AchievementsHidden);
        Assert.True(again.AchievementsHidden);
        Assert.True(me.AchievementsHidden);
        Assert.Empty(await HeldAsync(world.Account));
        Assert.Null(await StartOfAsync(world.Account));
        Assert.Single(await HeldAsync(other));
        await sharesAfter.ShouldBeProblemAsync(HttpStatusCode.NotFound, UserErrors.NotFound);
    }

    [Fact]
    public async Task A_user_who_opted_out_gets_nothing_from_a_cycle_or_the_sweep()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.Account);
        await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await world.Client.CreateTicketAsync("WEB", "After the opt-out");

        // Act
        var cycle = await api.RunCycleAsync();
        var sweep = await api.SweepAsync();

        // Assert
        Assert.Equal(new ProjectionResult(0, 0), cycle);
        Assert.Equal(0, sweep.Unlocked);
        Assert.Empty(await HeldAsync(world.Account));
        Assert.Null(await StartOfAsync(world.Account));
    }

    [Fact]
    public async Task Opting_back_in_restarts_counting_from_zero_at_that_moment()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.Account);
        await world.Client.CreateTicketAsync("WEB", "Counted before the opt-out");
        await api.RunCycleAsync();
        var heldBefore = await HeldAsync(world.Account);
        await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await world.Client.CreateTicketAsync("WEB", "While opted out");
        var beforeOptIn = DateTimeOffset.UtcNow;

        // Act
        var optedIn = await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = false }, _ct)).ReadAsync<CurrentUserDto>();
        var start = await StartOfAsync(world.Account);
        await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = false }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var startAfterRepeat = await StartOfAsync(world.Account);
        var cycleBeforeActivity = await api.RunCycleAsync();
        var heldAfterOptIn = await HeldAsync(world.Account);
        await world.Client.CreateTicketAsync("WEB", "After the opt-in");
        var cycleAfterActivity = await api.RunCycleAsync();

        // Assert
        Assert.Contains(heldBefore, a => a.AchievementId == AchievementCatalog.Reporter);
        Assert.False(optedIn.AchievementsHidden);
        Assert.NotNull(start);
        Assert.True(start >= beforeOptIn);
        Assert.Equal(start, startAfterRepeat);
        Assert.Equal(0, cycleBeforeActivity.Unlocked);
        Assert.Empty(heldAfterOptIn);
        Assert.Equal(1, cycleAfterActivity.Unlocked);
        var reporter = Assert.Single(await HeldAsync(world.Account));
        Assert.Equal((AchievementCatalog.Reporter, (short)1), (reporter.AchievementId, reporter.Tier));
    }

    [Fact]
    public async Task My_achievements_are_404_while_opted_out_and_return_after_opting_back_in()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.Account);
        await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var whileOut = await world.Client.GetAsync(MyAchievementsPath, _ct);
        await (await world.Client.PatchAsJsonAsync(MePath, new { achievementsHidden = false }, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var afterIn = await world.Client.GetAsync(MyAchievementsPath, _ct);

        // Assert
        await whileOut.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        var list = await afterIn.ReadAsync<MyAchievementsDto>();
        Assert.All(list.Items, i => Assert.Equal(0, i.Tier));
    }

    [Fact]
    public async Task With_the_flag_off_the_opt_out_is_rejected_and_nothing_in_the_request_is_applied()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync();
        await SeedAsync(world.Account, (AchievementCatalog.Reporter, 1));

        // Act
        var response = await world.Client.PatchAsJsonAsync(MePath, new { displayName = "Changed", achievementsHidden = true }, _ct);
        var me = await (await world.Client.GetAsync(MePath, _ct)).ReadAsync<CurrentUserDto>();
        var nameOnly = await world.Client.PatchAsJsonAsync(MePath, new { displayName = "Changed" }, _ct);

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.NotFound, AchievementErrors.Disabled);
        Assert.False(me.AchievementsHidden);
        Assert.Equal(world.Account.DisplayName, me.DisplayName);
        Assert.Single(await HeldAsync(world.Account));
        Assert.Equal("Changed", (await nameOnly.ReadAsync<CurrentUserDto>()).DisplayName);
    }

    [Fact]
    public async Task Personal_access_tokens_cannot_opt_out()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.Account);
        await SeedAsync(world.Account, (AchievementCatalog.Reporter, 1));
        var readOnly = await api.CreatePatClientAsync(world.Account, PatScope.ReadOnly);
        var readWrite = await api.CreatePatClientAsync(world.Account);

        // Act
        var readOnlyResponse = await readOnly.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct);
        var readWriteResponse = await readWrite.PatchAsJsonAsync(MePath, new { achievementsHidden = true }, _ct);

        // Assert
        await readOnlyResponse.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.ReadOnlyToken);
        await readWriteResponse.ShouldBeProblemAsync(HttpStatusCode.Forbidden, AppErrors.CookieSessionRequired);
        Assert.Single(await HeldAsync(world.Account));
        Assert.False(await api.WithDbAsync(db => db.Users.Where(u => u.Id == world.Account.Id).Select(u => u.AchievementsHidden).SingleAsync(_ct)));
    }

    private Task SeedAsync(TestUser user, params (string Id, int Tier)[] tiers) =>
        api.WithDbAsync(async db =>
        {
            foreach (var (id, tier) in tiers)
                db.UserAchievements.Add(UserAchievement.Create(user.Id, id, tier, DateTimeOffset.UtcNow));
            return await db.SaveChangesAsync(_ct);
        });

    private Task<List<UserAchievement>> HeldAsync(TestUser user) =>
        api.WithDbAsync(db => db.UserAchievements.AsNoTracking().Where(a => a.UserId == user.Id).ToListAsync(_ct));

    private Task<DateTimeOffset?> StartOfAsync(TestUser user) =>
        api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.AchievementsStartedAt).SingleAsync(_ct));

    private async Task<World> WorldAsync()
    {
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var account = await api.CreateUserAsync();
        var project = await owner.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, account, ProjectRole.Member);
        return new World(account, await api.LoginAsync(account));
    }

    private sealed record World(TestUser Account, HttpClient Client);
}
