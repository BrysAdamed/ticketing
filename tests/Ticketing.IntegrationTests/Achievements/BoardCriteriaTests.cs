using System.Net.Http.Json;
using Ticketing.Domain.Achievements;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Boards;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The board criteria of spec 15.4: board-builder (deleted boards don't count) and spring-cleaning (they still do).</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class BoardCriteriaTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Board_builder_counts_boards_created_after_the_start_over_any_channel_that_are_not_deleted()
    {
        // Arrange
        var (user, client, other) = await WorldAsync();
        await client.CreateBoardAsync("Before", "WEB");
        var start = DateTimeOffset.UtcNow;
        var deleted = await client.CreateBoardAsync("Deleted", "WEB");
        await ArchiveAsync(client, deleted.Id);
        (await client.DeleteAsync($"/api/v1/boards/{deleted.Id}", _ct)).EnsureSuccessStatusCode();
        var empty = await api.EvaluateAsync([new(user.Id, start)], [AchievementCatalog.BoardBuilder]);
        var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));
        await mcp.CallOkAsync("create_board", new() { ["name"] = "Over MCP", ["projectKeys"] = new[] { "WEB" } });
        await client.CreateBoardAsync("Over REST", "WEB");
        await (await api.LoginAsync(other)).CreateBoardAsync("Someone else's", "WEB");

        // Act
        var progress = await api.EvaluateAsync([new(user.Id, start), new(other.Id, start)], [AchievementCatalog.BoardBuilder]);

        // Assert
        Assert.Equal((0, 0), (empty.Single().Count, empty.Single().Tier));
        Assert.Equal((2, 1), progress.Where(p => p.UserId == user.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(1, progress.Single(p => p.UserId == other.Id).Count);
    }

    [Fact]
    public async Task Spring_cleaning_counts_an_archived_board_even_after_it_is_deleted()
    {
        // Arrange
        var (user, client, other) = await WorldAsync();
        var before = await client.CreateBoardAsync("Before", "WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        await ArchiveAsync(client, before.Id);
        var start = DateTimeOffset.UtcNow;
        var notYet = await api.CountAsync(user, start, AchievementCatalog.SpringCleaning);
        await ArchiveAsync(client, board.Id);
        (await client.PostAsync($"/api/v1/boards/{board.Id}/unarchive", null, _ct)).EnsureSuccessStatusCode();
        var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(user));
        await mcp.CallOkAsync("archive_board", new() { ["boardId"] = board.Id.ToString(), ["carryOverTo"] = "backlog" });
        (await client.DeleteAsync($"/api/v1/boards/{board.Id}", _ct)).EnsureSuccessStatusCode();

        // Act
        var progress = await api.EvaluateAsync([new(user.Id, start), new(other.Id, start)], [AchievementCatalog.SpringCleaning]);

        // Assert
        Assert.Equal(0, notYet);
        Assert.Equal((1, 1), progress.Where(p => p.UserId == user.Id).Select(p => (p.Count, p.Tier)).Single());
        Assert.Equal(0, progress.Single(p => p.UserId == other.Id).Count);
    }

    private async Task ArchiveAsync(HttpClient client, Guid boardId) =>
        (await client.PostAsJsonAsync($"/api/v1/boards/{boardId}/archive", new { carryOverTo = "backlog" }, HttpAssertions.Json, _ct)).EnsureSuccessStatusCode();

    private async Task<(TestUser User, HttpClient Client, TestUser Other)> WorldAsync()
    {
        var user = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        var client = await api.LoginAsync(user);
        var project = await client.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, other, ProjectRole.Member);
        return (user, client, other);
    }
}
