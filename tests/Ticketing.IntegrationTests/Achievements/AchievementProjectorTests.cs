using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Achievements;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The after-commit projector (spec 15.6, D-149): cycles, the sweep, the start S and who is skipped.</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class AchievementProjectorTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task An_action_over_rest_unlocks_its_tier_unseen_within_one_cycle_and_re_runs_add_nothing()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await world.User.CreateTicketAsync("WEB", "Over REST");

        // Act
        var first = await api.RunCycleAsync();
        var again = await api.RunCycleAsync();
        var swept = await api.SweepAsync();

        // Assert
        var held = await HeldAsync(world.UserAccount);
        var reporter = Assert.Single(held);
        Assert.Equal((AchievementCatalog.Reporter, (short)1), (reporter.AchievementId, reporter.Tier));
        Assert.Null(reporter.SeenAt);
        Assert.Equal(new ProjectionResult(1, 1), first);
        Assert.Equal(0, again.Unlocked);
        Assert.Equal(0, swept.Unlocked);
    }

    [Fact]
    public async Task An_action_over_mcp_unlocks_its_tiers_within_one_cycle()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await world.Mcp.CallOkAsync("create_ticket", new() { ["projectKey"] = "WEB", ["title"] = "Over MCP", ["type"] = "Bug" });

        // Act
        await api.RunCycleAsync();

        // Assert
        Assert.Equal(
            [AchievementCatalog.BugHunter, AchievementCatalog.MachineWhisperer, AchievementCatalog.Reporter],
            (await HeldAsync(world.UserAccount)).Select(a => a.AchievementId).Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Every_tier_up_to_the_reached_one_is_awarded_and_a_held_top_tier_is_not_evaluated_again()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await world.User.CreateTicketAsync("WEB", "First");
        await api.RunCycleAsync();
        await (await world.User.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch",
            new { tickets = Enumerable.Range(1, 9).Select(i => new { title = $"Batch {i}", type = "Technical" }) }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var cycle = await api.RunCycleAsync();

        // Assert
        Assert.Equal(1, cycle.Unlocked);
        Assert.Equal([1, 2], (await HeldAsync(world.UserAccount)).Where(a => a.AchievementId == AchievementCatalog.Reporter).Select(a => (int)a.Tier).Order());
    }

    [Fact]
    public async Task A_throwing_criterion_never_fails_a_write_and_the_next_healthy_cycle_awards_what_was_missed()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await using var failing = api.WithWebHostBuilder(b => b.ConfigureTestServices(s => s.AddSingleton<IAchievementCriterion, ThrowingCriterion>()));
        var client = failing.CreateDefaultClient(new Uri("https://localhost"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", await api.CreatePatAsync(world.UserAccount));

        // Act
        var write = await client.CreateTicketAsync("WEB", "Written while the projector is broken");
        await using (var scope = failing.Services.CreateAsyncScope())
            await Assert.ThrowsAnyAsync<InvalidOperationException>(() => scope.ServiceProvider.GetRequiredService<AchievementProjection>().RunCycleAsync(_ct));
        var afterFailure = await HeldAsync(world.UserAccount);
        var watermark = await api.WithDbAsync(db => db.AchievementProjectorStates.AnyAsync(_ct));
        var recovered = await api.RunCycleAsync();

        // Assert
        Assert.NotNull(write.Key);
        Assert.Empty(afterFailure);
        Assert.False(watermark);
        Assert.Equal(1, recovered.Unlocked);
    }

    [Fact]
    public async Task Deactivated_opted_out_and_flag_off_users_are_skipped_and_get_no_start()
    {
        // Arrange
        var world = await WorldAsync();
        var deactivated = await api.CreateUserAsync();
        var hidden = await api.CreateUserAsync();
        await api.AddMemberAsync(world.ProjectId, deactivated, ProjectRole.Member);
        await api.AddMemberAsync(world.ProjectId, hidden, ProjectRole.Member);
        await api.SetAchievementsFlagAsync(world.UserAccount, deactivated, hidden);
        await world.User.CreateTicketAsync("WEB", "Eligible");
        await world.Other.CreateTicketAsync("WEB", "Flag off");
        await (await api.LoginAsync(deactivated)).CreateTicketAsync("WEB", "Deactivated later");
        await (await api.LoginAsync(hidden)).CreateTicketAsync("WEB", "Opted out");
        await api.WithDbAsync(async db =>
        {
            (await db.Users.SingleAsync(u => u.Id == deactivated.Id, _ct)).Deactivate(world.OwnerAccount.Id, DateTimeOffset.UtcNow);
            (await db.Users.SingleAsync(u => u.Id == hidden.Id, _ct)).OptOutOfAchievements();
            return await db.SaveChangesAsync(_ct);
        });

        // Act
        var cycle = await api.RunCycleAsync();
        var sweep = await api.SweepAsync();

        // Assert
        Assert.Equal(new ProjectionResult(1, 1), cycle);
        Assert.Equal(1, sweep.Users);
        foreach (var skipped in new[] { world.OtherAccount, deactivated, hidden })
        {
            Assert.Empty(await HeldAsync(skipped));
            Assert.Null(await StartOfAsync(skipped));
        }
    }

    [Fact]
    public async Task The_first_cycle_stamps_the_start_at_the_users_earliest_entry_in_the_window()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await world.User.CreateTicketAsync("WEB", "First action after the flag flip");
        await world.User.CreateTicketAsync("WEB", "Second");
        var earliest = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.ActorId == world.UserAccount.Id).MinAsync(a => a.OccurredAt, _ct));

        // Act
        await api.RunCycleAsync();

        // Assert
        Assert.Equal(earliest, await StartOfAsync(world.UserAccount));
        Assert.Contains(await HeldAsync(world.UserAccount), a => a.AchievementId == AchievementCatalog.Reporter);
    }

    [Fact]
    public async Task Activity_before_an_existing_start_does_not_count()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await world.User.CreateTicketAsync("WEB", "Before the start");
        await api.ExecuteAsAsync(world.UserAccount, sp => sp.GetRequiredService<AchievementsGate>().EnsureStartedAsync(_ct));

        // Act
        var before = await api.RunCycleAsync();
        await world.User.CreateTicketAsync("WEB", "After the start");
        var after = await api.RunCycleAsync();

        // Assert
        Assert.Equal(0, before.Unlocked);
        Assert.Equal(1, after.Unlocked);
    }

    [Fact]
    public async Task A_flag_turned_off_and_on_keeps_the_start_and_activity_while_it_was_off_counts_once_it_is_back()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        await world.User.CreateTicketAsync("WEB", "First");
        await api.RunCycleAsync();
        var start = await StartOfAsync(world.UserAccount);
        await api.SetAchievementsFlagAsync();
        await (await world.User.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch",
            new { tickets = Enumerable.Range(1, 9).Select(i => new { title = $"While off {i}", type = "Technical" }) }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Act
        var whileOff = await api.RunCycleAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount);
        var sweep = await api.SweepAsync();

        // Assert
        Assert.Equal(new ProjectionResult(0, 0), whileOff);
        Assert.Equal(1, sweep.Unlocked);
        Assert.Equal(start, await StartOfAsync(world.UserAccount));
        Assert.Contains(await HeldAsync(world.UserAccount), a => a.AchievementId == AchievementCatalog.Reporter && a.Tier == 2);
    }

    [Fact]
    public async Task The_sweep_catches_activity_a_cycle_missed_but_only_for_users_with_a_start()
    {
        // Arrange
        var world = await WorldAsync();
        await api.SetAchievementsFlagAsync(world.UserAccount, world.OtherAccount);
        await api.ExecuteAsAsync(world.UserAccount, sp => sp.GetRequiredService<AchievementsGate>().EnsureStartedAsync(_ct));
        await world.User.CreateTicketAsync("WEB", "Missed by the cycle");
        await world.Other.CreateTicketAsync("WEB", "No start yet");
        await api.WithDbAsync(db =>
        {
            db.AchievementProjectorStates.Add(AchievementProjectorState.Create(DateTimeOffset.UtcNow.AddMinutes(10)));
            return db.SaveChangesAsync(_ct);
        });

        // Act
        var cycle = await api.RunCycleAsync();
        var sweep = await api.SweepAsync();

        // Assert
        Assert.Equal(new ProjectionResult(0, 0), cycle);
        Assert.Equal(new ProjectionResult(1, 1), sweep);
        Assert.Empty(await HeldAsync(world.OtherAccount));
        Assert.Null(await StartOfAsync(world.OtherAccount));
    }

    private Task<List<UserAchievement>> HeldAsync(TestUser user) =>
        api.WithDbAsync(db => db.UserAchievements.AsNoTracking().Where(a => a.UserId == user.Id).ToListAsync(_ct));

    private Task<DateTimeOffset?> StartOfAsync(TestUser user) =>
        api.WithDbAsync(db => db.Users.Where(u => u.Id == user.Id).Select(u => u.AchievementsStartedAt).SingleAsync(_ct));

    private async Task<World> WorldAsync()
    {
        var ownerAccount = await api.CreateUserAsync();
        var userAccount = await api.CreateUserAsync();
        var otherAccount = await api.CreateUserAsync();
        var owner = await api.LoginAsync(ownerAccount);
        var project = await owner.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, userAccount, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, otherAccount, ProjectRole.Member);
        var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(userAccount));
        return new World(project.Id, ownerAccount, userAccount, otherAccount, await api.LoginAsync(userAccount), await api.LoginAsync(otherAccount), mcp);
    }

    private sealed record World(
        Guid ProjectId, TestUser OwnerAccount, TestUser UserAccount, TestUser OtherAccount, HttpClient User, HttpClient Other,
        ModelContextProtocol.Client.McpClient Mcp);

    private sealed class ThrowingCriterion : ComputedAchievementCriterion
    {
        public override string AchievementId => AchievementCatalog.Reporter;

        public override IReadOnlyCollection<string>? Triggers => null;

        public override Task<IReadOnlyList<AchievementCount>> CountAsync(
            ITicketingDbContext db, IReadOnlyList<AchievementSubject> subjects, CancellationToken cancellationToken) =>
            throw new InvalidOperationException("A broken criterion.");
    }
}
