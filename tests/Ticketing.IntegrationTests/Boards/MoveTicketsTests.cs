using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Backlog;
using Ticketing.Application.Common;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Boards;

[Collection(nameof(BoardsCollection))]
public sealed class MoveTicketsTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Placing_from_the_backlog_goes_to_the_bottom_of_the_column_and_writes_one_moved_entry_each()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(4);

        // Act
        var first = await client.MoveOkAsync(board.ToString(), [keys[0], keys[1]]);
        var second = await client.MoveOkAsync(board.ToString(), [keys[2]]);

        // Assert
        Assert.All(first.Concat(second), t => Assert.Equal((TicketLocationKind.Board, board), (t.Location.Kind, t.Location.BoardId!.Value)));
        Assert.Equal(["ToDo: WEB-1, WEB-2, WEB-3"], (await client.GetBoardAsync(board)).Layout());
        var entries = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.Action == "ticket.moved").ToListAsync(_ct));
        Assert.Equal(3, entries.Count);
        Assert.All(entries, e => Assert.Equal(("boardId", (string?)null, $"\"{board}\""), (e.Field, e.OldValue, e.NewValue)));
    }

    [Fact]
    public async Task Dropping_into_another_column_changes_status_with_its_side_effects_and_ranks_within_the_column()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(4);
        await client.MoveOkAsync(board.ToString(), [keys[0], keys[1], keys[2]], "Review");

        // Act
        var done = await client.MoveOkAsync(board.ToString(), [keys[3]], "Done");
        var between = await client.MoveOkAsync(board.ToString(), [keys[3]], "Review", beforeKey: keys[1]);
        var top = await client.MoveOkAsync(board.ToString(), [keys[2]], "Review", beforeKey: keys[0]);

        // Assert
        Assert.Equal(TicketStatus.Done, done[0].Status);
        Assert.Equal(TicketStatus.Review, between[0].Status);
        Assert.Equal(TicketStatus.Review, top[0].Status);
        Assert.Equal(["Review: WEB-3, WEB-1, WEB-4, WEB-2"], (await client.GetBoardAsync(board)).Layout());
        var ticket = await client.GetTicketAsync(keys[3]);
        Assert.Equal(((Resolution?)null, (DateTimeOffset?)null), (ticket.Resolution, ticket.ResolvedAt));
        var history = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.EntityId == ticket.Id && a.Action == "ticket.field.changed")
            .Select(a => new { a.Field, a.NewValue })
            .ToListAsync(_ct));
        Assert.Equal(
            ["resolution:", "resolution:\"Done\"", "status:\"Done\"", "status:\"Review\""],
            history.Select(h => $"{h.Field}:{h.NewValue}").Order(StringComparer.Ordinal));
    }

    [Fact]
    public async Task Multi_select_moves_keep_the_sent_order_after_an_anchor_and_reorders_write_no_history()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(5);
        await client.MoveOkAsync(board.ToString(), keys);
        var before = await api.WithDbAsync(db => db.ActivityEntries.CountAsync(_ct));

        // Act
        await client.MoveOkAsync(board.ToString(), [keys[4], keys[2]], afterKey: keys[0]);
        var after = await api.WithDbAsync(db => db.ActivityEntries.CountAsync(_ct));

        // Assert
        Assert.Equal(["ToDo: WEB-1, WEB-5, WEB-3, WEB-2, WEB-4"], (await client.GetBoardAsync(board)).Layout());
        Assert.Equal(before, after);
    }

    [Fact]
    public async Task Sending_back_to_the_backlog_goes_to_the_top_and_supports_backlog_reorder()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(5);
        await client.MoveOkAsync(board.ToString(), [keys[3], keys[4]], "InProgress");

        // Act
        var back = await client.MoveOkAsync("backlog", [keys[4], keys[3]]);
        await client.MoveOkAsync("BACKLOG", [keys[0]], afterKey: keys[2]);

        // Assert
        Assert.All(back, t => Assert.Equal((TicketLocationKind.Backlog, TicketStatus.InProgress), (t.Location.Kind, t.Status)));
        var backlog = await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>();
        Assert.Equal(["WEB-5", "WEB-4", "WEB-2", "WEB-3", "WEB-1"], backlog.Items.Select(i => i.Key));
        Assert.Empty((await client.GetBoardAsync(board)).Keys());
    }

    [Fact]
    public async Task Moving_to_another_board_and_mixed_projects_to_their_own_backlogs()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(2);
        await client.CreateProjectAsync("API");
        var other = (await client.CreateBoardAsync("Other", "WEB", "API")).Id;
        await (await client.PatchBoardAsync(board, new { addProjectKeys = new[] { "API" } })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var apiTicket = await client.CreateTicketAsync("API", "Api work");
        await client.MoveOkAsync(board.ToString(), [keys[0], apiTicket.Key]);

        // Act
        var moved = await client.MoveOkAsync(other.ToString(), [keys[0]], "Testing");
        var back = await client.MoveOkAsync("backlog", [apiTicket.Key, keys[0]]);
        var anchoredAcrossProjects = await client.MoveAsync("backlog", [apiTicket.Key, keys[0]], beforeKey: keys[1]);

        // Assert
        Assert.Equal((other, TicketStatus.Testing), (moved[0].Location.BoardId!.Value, moved[0].Status));
        Assert.Equal([apiTicket.Key, keys[0]], back.Select(t => t.Key));
        var entry = await api.WithDbAsync(db => db.ActivityEntries.Where(a => a.EntityId == moved[0].Id && a.Action == "ticket.moved").OrderBy(a => a.OccurredAt).Skip(1).FirstAsync(_ct));
        Assert.Equal(($"\"{board}\"", $"\"{other}\""), (entry.OldValue, entry.NewValue));
        await anchoredAcrossProjects.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
    }

    [Fact]
    public async Task Moves_are_rejected_for_unlinked_projects_missing_boards_and_bad_input()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(2);
        await client.CreateProjectAsync("API");
        var apiTicket = await client.CreateTicketAsync("API", "Not linked");
        await client.MoveOkAsync(board.ToString(), [keys[0]]);

        // Act
        var unlinked = await client.MoveAsync(board.ToString(), [keys[1], apiTicket.Key]);
        var missing = await client.MoveAsync(Guid.NewGuid().ToString(), [keys[1]]);
        var badTarget = await client.MoveAsync("nowhere", [keys[1]]);
        var duplicate = await client.MoveAsync(board.ToString(), [keys[1], "web-2"]);
        var selfAnchor = await client.MoveAsync(board.ToString(), [keys[1]], beforeKey: keys[1]);
        var anchorElsewhere = await client.MoveAsync(board.ToString(), [keys[1]], beforeKey: apiTicket.Key);
        var unknownTicket = await client.MoveAsync(board.ToString(), ["WEB-99"]);

        // Assert
        await unlinked.ShouldBeProblemAsync(HttpStatusCode.Conflict, BoardErrors.ProjectNotLinked);
        await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, BoardErrors.NotFound);
        await badTarget.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        await duplicate.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        await selfAnchor.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        await anchorElsewhere.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.RankAnchorInvalid);
        await unknownTicket.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        Assert.Equal(["ToDo: WEB-1"], (await client.GetBoardAsync(board)).Layout());
    }

    [Fact]
    public async Task A_source_guard_rejects_moves_from_stale_views_and_position_places_at_the_edges()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(4);
        var other = (await client.CreateBoardAsync("Other", "WEB")).Id;
        await client.MoveOkAsync(board.ToString(), [keys[0], keys[1], keys[2]]);
        await client.MoveOkAsync(other.ToString(), [keys[2]]);

        // Act
        var staleBoard = await client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { keys[2] }, target = board.ToString(), from = board.ToString() }, HttpAssertions.Json, _ct);
        var staleBacklog = await client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { keys[0] }, target = "backlog", from = "backlog" }, HttpAssertions.Json, _ct);
        var top = await client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { keys[1] }, target = board.ToString(), from = board.ToString(), position = "Top" }, HttpAssertions.Json, _ct);
        var tooMany = await client.MoveAsync("backlog", [.. Enumerable.Range(1, MoveTickets.MaxTickets + 1).Select(i => $"WEB-{i}")]);

        // Assert
        await staleBoard.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotInSource);
        await staleBacklog.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotInSource);
        await top.ShouldHaveStatusAsync(HttpStatusCode.OK);
        await tooMany.ShouldBeProblemAsync(HttpStatusCode.BadRequest, AppErrors.Validation);
        Assert.Equal(["ToDo: WEB-2, WEB-1"], (await client.GetBoardAsync(board)).Layout());
        Assert.Equal(["ToDo: WEB-3"], (await client.GetBoardAsync(other)).Layout());
    }

    [Fact]
    public async Task Moving_needs_write_access_to_each_ticket_and_hides_private_tickets()
    {
        // Arrange
        var (client, board, keys) = await SetUpAsync(1);
        var project = await api.WithDbAsync(db => db.Projects.SingleAsync(p => p.Key == "WEB", _ct));
        var viewer = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        var viewerClient = await api.LoginAsync(viewer);
        var outsider = await api.LoginAsync(await api.CreateUserAsync());
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));

        // Act
        var asViewer = await viewerClient.MoveAsync(board.ToString(), keys);
        var asOutsider = await outsider.MoveAsync(board.ToString(), keys);
        var asAdmin = await admin.MoveAsync(board.ToString(), keys);

        // Assert
        await asViewer.ShouldBeProblemAsync(HttpStatusCode.Forbidden, ProjectErrors.Forbidden);
        await asOutsider.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        await asAdmin.ShouldHaveStatusAsync(HttpStatusCode.OK);
        var viewerBoard = await viewerClient.GetBoardAsync(board);
        Assert.False(Assert.Single(viewerBoard.Projects).CanWrite);
    }

    private async Task<(HttpClient Client, Guid BoardId, string[] Keys)> SetUpAsync(int tickets)
    {
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var board = await client.CreateBoardAsync("Sprint", "WEB");
        var keys = new string[tickets];
        for (var i = 0; i < tickets; i++)
            keys[i] = (await client.CreateTicketAsync("WEB", $"Ticket {i + 1}")).Key;
        return (client, board.Id, keys);
    }
}
