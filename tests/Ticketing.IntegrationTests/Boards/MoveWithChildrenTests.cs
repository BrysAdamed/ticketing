using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Backlog;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Boards;

[Collection(nameof(BoardsCollection))]
public sealed class MoveWithChildrenTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task An_epic_moves_with_its_stories_and_sub_tasks_right_after_it_and_a_status_applies_to_the_epic_only()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "Epic", "Epic");
        await client.CreateTicketAsync("WEB", "Unrelated");
        await client.CreateTicketAsync("WEB", "Story A", extra: new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Story B", extra: new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Task of A", "Technical", new { parentKey = "WEB-3" });
        await client.MoveOkAsync(board.ToString(), ["WEB-2"]);

        // Act
        var preview = await client.PreviewAsync(["WEB-1"], "backlog");
        var moved = await client.MoveWithChildrenAsync(board.ToString(), ["WEB-1"], status: "InProgress");

        // Assert
        var parent = Assert.Single(preview.Parents);
        Assert.Equal(("WEB-1", 3, 0, 0, 0), (parent.Key, preview.Count, preview.OnOtherBoard, preview.InBacklog, preview.Done));
        Assert.Equal(["WEB-3", "WEB-4", "WEB-5"], parent.Children.Select(c => c.Key));
        Assert.Equal(["WEB-1", "WEB-3", "WEB-4", "WEB-5"], moved.Select(t => t.Key));
        Assert.Equal(["ToDo: WEB-2, WEB-3, WEB-4, WEB-5", "InProgress: WEB-1"], (await client.GetBoardAsync(board)).Layout());
        var movedEntries = await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == "ticket.moved", _ct));
        Assert.Equal(5, movedEntries);
    }

    [Fact]
    public async Task Children_on_another_board_done_or_deleted_stay_where_they_are()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        var other = (await client.CreateBoardAsync("Other", "WEB")).Id;
        await client.CreateTicketAsync("WEB", "Story", "UserStory");
        await client.CreateTicketAsync("WEB", "Elsewhere", "Technical", new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Finished", "Technical", new { parentKey = "WEB-1", status = "Done" });
        await client.CreateTicketAsync("WEB", "Gone", "Technical", new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Comes along", "Technical", new { parentKey = "WEB-1" });
        await client.MoveOkAsync(other.ToString(), ["WEB-2"]);
        await (await client.DeleteAsync("/api/v1/tickets/WEB-4", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);

        // Act
        var preview = await client.PreviewAsync(["WEB-1"]);
        var moved = await client.MoveWithChildrenAsync(board.ToString(), ["WEB-1"]);

        // Assert
        Assert.Equal((1, 1, 0, 1), (preview.Count, preview.OnOtherBoard, preview.InBacklog, preview.Done));
        Assert.Equal(["WEB-1", "WEB-5"], moved.Select(t => t.Key));
        Assert.Equal(["ToDo: WEB-2"], (await client.GetBoardAsync(other)).Layout());
        Assert.Equal(TicketLocationKind.Backlog, (await client.GetTicketAsync("WEB-3")).Location.Kind);
    }

    [Fact]
    public async Task A_parent_sent_with_its_own_child_moves_each_ticket_once_and_the_child_keeps_its_own_sub_tasks()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "Epic", "Epic");
        await client.CreateTicketAsync("WEB", "Story A", extra: new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Story B", extra: new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Task of B", "Technical", new { parentKey = "WEB-3" });

        // Act
        var preview = await client.PreviewAsync(["WEB-3", "WEB-1"]);
        var moved = await client.MoveWithChildrenAsync(board.ToString(), ["WEB-3", "WEB-1"]);

        // Assert
        Assert.Equal(2, preview.Count);
        Assert.Equal([["WEB-4"], ["WEB-2"]], preview.Parents.Select(p => p.Children.Select(c => c.Key).ToArray()));
        Assert.Equal(["WEB-3", "WEB-4", "WEB-1", "WEB-2"], moved.Select(t => t.Key));
        Assert.Equal(["ToDo: WEB-3, WEB-4, WEB-1, WEB-2"], (await client.GetBoardAsync(board)).Layout());
    }

    [Fact]
    public async Task Board_to_backlog_takes_only_the_children_on_the_board_being_left()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "Story");
        await client.CreateTicketAsync("WEB", "On the board", "Technical", new { parentKey = "WEB-1" });
        await client.CreateTicketAsync("WEB", "Still in the backlog", "Technical", new { parentKey = "WEB-1" });
        await client.MoveOkAsync(board.ToString(), ["WEB-1", "WEB-2"]);

        // Act
        var preview = await client.PreviewAsync(["WEB-1"], board.ToString());
        var moved = await client.MoveWithChildrenAsync("backlog", ["WEB-1"]);

        // Assert
        Assert.Equal((1, 0, 1, 0), (preview.Count, preview.OnOtherBoard, preview.InBacklog, preview.Done));
        Assert.Equal(["WEB-1", "WEB-2"], moved.Select(t => t.Key));
        Assert.Empty((await client.GetBoardAsync(board)).Keys());
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>();
        Assert.Equal(["WEB-1", "WEB-2", "WEB-3"], backlog.Items.Select(i => i.Key));
    }

    [Fact]
    public async Task Without_include_children_only_the_sent_tickets_move()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "Story");
        await client.CreateTicketAsync("WEB", "Task", "Technical", new { parentKey = "WEB-1" });

        // Act
        var moved = await client.MoveOkAsync(board.ToString(), ["WEB-1"]);
        var explicitFalse = await client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { "WEB-1" }, target = "backlog", includeChildren = false }, HttpAssertions.Json, _ct);

        // Assert
        Assert.Equal(["WEB-1"], moved.Select(t => t.Key));
        Assert.Equal(["WEB-1"], (await explicitFalse.ReadAsync<List<TicketSummaryDto>>()).Select(t => t.Key));
        Assert.Empty((await client.GetBoardAsync(board)).Keys());
    }

    [Fact]
    public async Task Over_the_limit_with_children_nothing_moves()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "Epic", "Epic");
        for (var batch = 0; batch < 2; batch++)
        {
            var tickets = Enumerable.Range(0, CreateTickets.MaxItems).Select(i => new { title = $"Story {batch}-{i}", type = "UserStory", parentKey = "WEB-1" });
            await (await client.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch", new { tickets }, HttpAssertions.Json, _ct))
                .ShouldHaveStatusAsync(HttpStatusCode.Created);
        }

        // Act
        var response = await client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { "WEB-1" }, target = board.ToString(), includeChildren = true }, HttpAssertions.Json, _ct);
        var withoutChildren = await client.MoveOkAsync(board.ToString(), ["WEB-1"]);

        // Assert
        var problem = await response.ShouldBeProblemAsync(HttpStatusCode.BadRequest, TicketErrors.MoveTooMany);
        Assert.Contains("101", problem.GetProperty("title").GetString(), StringComparison.Ordinal);
        Assert.True(problem.TryGetProperty("hint", out _));
        Assert.Equal(["WEB-1"], withoutChildren.Select(t => t.Key));
        Assert.Equal(1, await api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == "ticket.moved", _ct)));
    }

    [Fact]
    public async Task Moving_with_children_needs_write_access_and_the_preview_hides_private_tickets()
    {
        // Arrange
        var (client, board) = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "Story");
        await client.CreateTicketAsync("WEB", "Task", "Technical", new { parentKey = "WEB-1" });
        var project = await api.WithDbAsync(db => db.Projects.SingleAsync(p => p.Key == "WEB", _ct));
        var viewer = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        var viewerClient = await api.LoginAsync(viewer);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var asViewer = await viewerClient.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { "WEB-1" }, target = board.ToString(), includeChildren = true }, HttpAssertions.Json, _ct);
        var viewerPreview = await viewerClient.PreviewAsync(["WEB-1"]);
        var outsiderPreview = await outsider.GetAsync("/api/v1/tickets/move/children?keys=WEB-1", _ct);
        var stale = await client.GetAsync($"/api/v1/tickets/move/children?keys=WEB-1&from={board}", _ct);

        // Assert
        await asViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        Assert.Equal(1, viewerPreview.Count);
        await outsiderPreview.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await stale.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotInSource);
        Assert.Empty((await client.GetBoardAsync(board)).Keys());
    }

    private async Task<(HttpClient Client, Guid BoardId)> SetUpAsync()
    {
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint 1", "WEB");
        return (client, board.Id);
    }
}

internal static class MoveWithChildrenClient
{
    public static async Task<IReadOnlyList<TicketSummaryDto>> MoveWithChildrenAsync(
        this HttpClient client, string target, string[] keys, string? status = null) =>
        await (await client.PostAsJsonAsync("/api/v1/tickets/move", new { keys, target, status, includeChildren = true }, HttpAssertions.Json))
            .ReadAsync<List<TicketSummaryDto>>();

    public static async Task<MoveChildrenPreviewDto> PreviewAsync(this HttpClient client, string[] keys, string? from = null)
    {
        var query = string.Join("&", keys.Select(k => $"keys={k}")) + (from is null ? "" : $"&from={from}");
        return await (await client.GetAsync($"/api/v1/tickets/move/children?{query}")).ReadAsync<MoveChildrenPreviewDto>();
    }
}
