using System.Net;
using System.Net.Http.Json;
using ModelContextProtocol.Client;
using Ticketing.Application.Regressions;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Testing;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The testing criteria of spec 15.4: test-author, regression-runner, found-it and full-sweep.</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class TestingCriteriaTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Test_author_counts_test_cases_created_after_the_start_archived_included_and_deleted_excluded()
    {
        // Arrange
        var world = await WorldAsync();
        await world.User.CreateManualCaseAsync("WEB", "Before the start");
        var start = DateTimeOffset.UtcNow;
        await world.User.CreateManualCaseAsync("WEB", "Over REST");
        await world.Mcp.CallOkAsync("create_test_case", new() { ["projectKey"] = "WEB", ["title"] = "Over MCP" });
        var archived = await world.User.CreateManualCaseAsync("WEB", "Archived later");
        (await world.User.PatchAsJsonAsync($"/api/v1/test-cases/{archived.Key}", new { archived = true }, HttpAssertions.Json, _ct)).EnsureSuccessStatusCode();
        var deleted = await world.User.CreateManualCaseAsync("WEB", "Deleted later");
        (await world.Owner.DeleteAsync($"/api/v1/test-cases/{deleted.Key}", _ct)).EnsureSuccessStatusCode();
        await world.Other.CreateManualCaseAsync("WEB", "Someone else's");

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.TestAuthor]);

        // Assert
        Assert.Equal(3, progress.Single(p => p.UserId == world.UserAccount.Id).Count);
        Assert.Equal(1, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Regression_runner_counts_each_session_item_once_and_not_resets_to_waiting()
    {
        // Arrange
        var world = await WorldAsync();
        foreach (var title in new[] { "One", "Two", "Three", "Four" })
            await world.Owner.CreateManualCaseAsync("WEB", title);
        var session = await world.Owner.StartSessionAsync("WEB");
        await Record(world.User, session.Key, "WEB-TC-1", "Passed");
        var start = DateTimeOffset.UtcNow;
        await Record(world.User, session.Key, "WEB-TC-1", "Skipped");
        await Record(world.User, session.Key, "WEB-TC-2", "Passed");
        await Record(world.User, session.Key, "WEB-TC-2", "Failed", "Broken");
        await world.Mcp.CallOkAsync("record_regression_result", new() { ["sessionKey"] = session.Key, ["testCaseKey"] = "WEB-TC-3", ["status"] = "Passed" });
        await Record(world.User, session.Key, "WEB-TC-4", "WaitingForExecution");
        await Record(world.Other, session.Key, "WEB-TC-4", "Passed");

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.RegressionRunner]);

        // Assert
        Assert.Equal((3, 0), progress.Where(p => p.UserId == world.UserAccount.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    [Fact]
    public async Task Found_it_counts_bugs_filed_from_failed_items_that_are_still_alive()
    {
        // Arrange
        var world = await WorldAsync();
        foreach (var title in new[] { "One", "Two", "Three" })
            await world.Owner.CreateManualCaseAsync("WEB", title);
        var session = await world.Owner.StartSessionAsync("WEB");
        var start = DateTimeOffset.UtcNow;
        await Record(world.User, session.Key, "WEB-TC-1", "Failed", "Broken");
        await (await world.User.PostAsJsonAsync($"/api/v1/regression-sessions/{session.Key}/items/WEB-TC-1/bug", new { }, HttpAssertions.Json, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        await world.Mcp.CallOkAsync("record_regression_result", new()
        {
            ["sessionKey"] = session.Key, ["testCaseKey"] = "WEB-TC-2", ["status"] = "Failed", ["note"] = "Broken", ["createBug"] = true,
        });
        await Record(world.User, session.Key, "WEB-TC-3", "Failed", "Broken");
        var deleted = await (await world.User.PostAsJsonAsync($"/api/v1/regression-sessions/{session.Key}/items/WEB-TC-3/bug", new { }, HttpAssertions.Json, _ct))
            .ReadAsync<RegressionItemChangeDto>(HttpStatusCode.Created);
        (await world.Owner.DeleteAsync($"/api/v1/tickets/{deleted.CreatedBug!.Key}", _ct)).EnsureSuccessStatusCode();

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.FoundIt, AchievementCatalog.BugHunter]);

        // Assert
        Assert.Equal(2, progress.Single(p => p.UserId == world.UserAccount.Id && p.AchievementId == AchievementCatalog.FoundIt).Count);
        Assert.Equal(2, progress.Single(p => p.UserId == world.UserAccount.Id && p.AchievementId == AchievementCatalog.BugHunter).Count);
        Assert.All(progress.Where(p => p.UserId == world.OtherAccount.Id), p => Assert.Equal(0, p.Count));
    }

    [Fact]
    public async Task Full_sweep_counts_completed_sessions_but_not_cancelled_ones_or_sessions_of_a_deleted_project()
    {
        // Arrange
        var world = await WorldAsync();
        await world.Owner.CreateManualCaseAsync("WEB", "One");
        var before = await world.User.StartSessionAsync("WEB");
        await CompleteAsync(world.User, before.Key);
        var start = DateTimeOffset.UtcNow;
        await CompleteAsync(world.User, (await world.User.StartSessionAsync("WEB")).Key);
        var overMcp = await world.User.StartSessionAsync("WEB");
        await world.Mcp.CallOkAsync("complete_regression_session", new() { ["sessionKey"] = overMcp.Key, ["skipRemaining"] = true });
        var cancelled = await world.User.StartSessionAsync("WEB");
        (await world.User.PostAsync($"/api/v1/regression-sessions/{cancelled.Key}/cancel", null, _ct)).EnsureSuccessStatusCode();
        await CompleteAsync(world.Other, (await world.Other.StartSessionAsync("WEB")).Key);
        var gone = await world.Owner.CreateProjectAsync("GONE");
        await api.AddMemberAsync(gone.Id, world.UserAccount, ProjectRole.Member);
        await world.Owner.CreateManualCaseAsync("GONE", "One");
        await CompleteAsync(world.User, (await world.User.StartSessionAsync("GONE")).Key);
        await api.DeleteProjectAsync("GONE");

        // Act
        var progress = await api.EvaluateAsync(
            [new(world.UserAccount.Id, start), new(world.OtherAccount.Id, start)], [AchievementCatalog.FullSweep]);

        // Assert
        Assert.Equal((2, 1), progress.Where(p => p.UserId == world.UserAccount.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == world.OtherAccount.Id).Count);
    }

    private async Task Record(HttpClient client, string sessionKey, string testCaseKey, string status, string? note = null)
    {
        if (status != "WaitingForExecution")
            (await client.TakeAsync(sessionKey, testCaseKey)).EnsureSuccessStatusCode();
        await (await client.RecordAsync(sessionKey, testCaseKey, status, note)).ShouldHaveStatusAsync(HttpStatusCode.OK);
    }

    private async Task CompleteAsync(HttpClient client, string sessionKey) =>
        (await client.PostAsJsonAsync($"/api/v1/regression-sessions/{sessionKey}/complete", new { skipRemaining = true }, HttpAssertions.Json, _ct))
            .EnsureSuccessStatusCode();

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
        return new World(userAccount, otherAccount, owner, await api.LoginAsync(userAccount), await api.LoginAsync(otherAccount), mcp);
    }

    private sealed record World(TestUser UserAccount, TestUser OtherAccount, HttpClient Owner, HttpClient User, HttpClient Other, McpClient Mcp);
}
