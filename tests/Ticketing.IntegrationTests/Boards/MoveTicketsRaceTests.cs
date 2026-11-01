using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ticketing.Application.Backlog;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Boards;

/// <summary>D-179: a move locks its containers, then its ticket rows, so an edit committing while it runs is waited for and never fails it.</summary>
[Collection(nameof(BoardsCollection))]
public sealed class MoveTicketsRaceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_backlog_reorder_succeeds_when_an_edit_of_the_ticket_commits_while_it_runs()
    {
        // Arrange
        var client = await SetUpAsync();
        await client.CreateTicketAsync("WEB", "First");
        await client.CreateTicketAsync("WEB", "Second");
        var before = await BacklogKeysAsync(client);
        var moving = await client.GetTicketAsync(before[0]);
        await using var edit = await HoldEditAsync(moving.Id);

        // Act
        var move = client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { moving.Key }, target = "backlog", from = "backlog", afterKey = before[1] }, HttpAssertions.Json, _ct);
        await api.UntilSomeoneWaitsAsync(_ct);
        await edit.CommitAsync(_ct);
        var response = await move;

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal([before[1], before[0]], await BacklogKeysAsync(client));
        var stored = await api.WithDbAsync(db => db.Tickets.AsNoTracking().SingleAsync(t => t.Id == moving.Id, _ct));
        Assert.Equal(5, stored.StoryPoints);
    }

    [Fact]
    public async Task A_move_to_a_board_with_sub_tickets_succeeds_when_an_edit_of_a_sub_ticket_commits_while_it_runs()
    {
        // Arrange
        var client = await SetUpAsync();
        var board = await client.CreateBoardAsync("Sprint 1", "WEB");
        await client.CreateTicketAsync("WEB", "Story", "UserStory");
        var child = await client.CreateTicketAsync("WEB", "Task", "Technical", new { parentKey = "WEB-1" });
        await using var edit = await HoldEditAsync(child.Id);

        // Act
        var move = client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { "WEB-1" }, target = board.Id.ToString(), status = "InProgress", includeChildren = true },
            HttpAssertions.Json, _ct);
        await api.UntilSomeoneWaitsAsync(_ct);
        await edit.CommitAsync(_ct);
        var response = await move;

        // Assert
        await response.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.Equal(["ToDo: WEB-2", "InProgress: WEB-1"], (await client.GetBoardAsync(board.Id)).Layout());
        var stored = await api.WithDbAsync(db => db.Tickets.AsNoTracking().SingleAsync(t => t.Id == child.Id, _ct));
        Assert.Equal(5, stored.StoryPoints);
    }

    [Fact]
    public async Task A_move_of_a_ticket_someone_else_moved_meanwhile_is_a_conflict_and_changes_nothing()
    {
        // Arrange
        var client = await SetUpAsync();
        var board = await client.CreateBoardAsync("Sprint 1", "WEB");
        await client.CreateTicketAsync("WEB", "First");
        var moving = await client.CreateTicketAsync("WEB", "Second");
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var other = await connection.BeginTransactionAsync(_ct);
        await using (var update = new NpgsqlCommand("UPDATE tickets SET board_id = @board WHERE id = @id", connection, other))
        {
            update.Parameters.AddWithValue("board", board.Id);
            update.Parameters.AddWithValue("id", moving.Id);
            Assert.Equal(1, await update.ExecuteNonQueryAsync(_ct));
        }

        // Act
        var move = client.PostAsJsonAsync(
            "/api/v1/tickets/move", new { keys = new[] { moving.Key }, target = "backlog", beforeKey = "WEB-1" }, HttpAssertions.Json, _ct);
        await api.UntilSomeoneWaitsAsync(_ct);
        await other.CommitAsync(_ct);
        var response = await move;

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, TicketErrors.NotInSource);
        Assert.Equal(["ToDo: WEB-2"], (await client.GetBoardAsync(board.Id)).Layout());
    }

    [Fact]
    public async Task Parallel_moves_edits_and_a_board_archive_never_deadlock()
    {
        // Arrange
        var client = await SetUpAsync();
        var board = await client.CreateBoardAsync("Sprint 1", "WEB");
        var other = await client.CreateBoardAsync("Sprint 2", "WEB");
        var keys = new List<string>();
        for (var i = 0; i < 6; i++)
            keys.Add((await client.CreateTicketAsync("WEB", $"Ticket {i}")).Key);
        await client.MoveOkAsync(other.Id.ToString(), [keys[4], keys[5]]);

        // Act
        var requests = new List<Task<HttpResponseMessage>>();
        for (var round = 0; round < 4; round++)
        {
            requests.Add(client.MoveAsync("backlog", [keys[0], keys[1]], beforeKey: keys[2]));
            requests.Add(client.MoveAsync("backlog", [keys[2]], beforeKey: keys[0]));
            requests.Add(client.MoveAsync(board.Id.ToString(), [keys[3]], round % 2 == 0 ? "InProgress" : "ToDo"));
            requests.Add(client.MoveAsync("backlog", [keys[3]]));
            requests.Add(client.MoveAsync(other.Id.ToString(), [keys[4]], beforeKey: keys[5]));
            requests.Add(client.PatchAsJsonAsync($"/api/v1/tickets/{keys[round % 6]}", new { priority = round % 2 == 0 ? "High" : "Low" }, _ct));
            requests.Add(client.PatchAsJsonAsync($"/api/v1/tickets/{keys[4]}", new { storyPoints = round }, _ct));
        }
        requests.Add(client.PostAsJsonAsync($"/api/v1/boards/{other.Id}/archive", new { carryOverTo = "backlog" }, HttpAssertions.Json, _ct));
        var responses = await Task.WhenAll(requests);

        // Assert
        foreach (var response in responses)
        {
            if (response.StatusCode == HttpStatusCode.OK)
                continue;
            var body = await response.Content.ReadAsStringAsync(_ct);
            Assert.True(
                response.StatusCode == HttpStatusCode.Conflict && (body.Contains(BoardErrors.Archived) || body.Contains(TicketErrors.NotInSource)),
                $"{response.RequestMessage!.RequestUri} answered {(int)response.StatusCode}: {body}");
        }
    }

    private async Task<HttpClient> SetUpAsync()
    {
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        return client;
    }

    /// <summary>An uncommitted field edit of the ticket, holding its row until committed.</summary>
    private async Task<HeldEdit> HoldEditAsync(Guid ticketId)
    {
        var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        var transaction = await connection.BeginTransactionAsync(_ct);
        await using var update = new NpgsqlCommand("UPDATE tickets SET story_points = 5 WHERE id = @id", connection, transaction);
        update.Parameters.AddWithValue("id", ticketId);
        Assert.Equal(1, await update.ExecuteNonQueryAsync(_ct));
        return new HeldEdit(connection, transaction);
    }

    private async Task<string[]> BacklogKeysAsync(HttpClient client) =>
        [.. (await (await client.GetAsync("/api/v1/projects/WEB/backlog", _ct)).ReadAsync<BacklogDto>()).Items.Select(i => i.Key)];

    private sealed class HeldEdit(NpgsqlConnection connection, NpgsqlTransaction transaction) : IAsyncDisposable
    {
        public Task CommitAsync(CancellationToken cancellationToken) => transaction.CommitAsync(cancellationToken);

        public async ValueTask DisposeAsync()
        {
            await transaction.DisposeAsync();
            await connection.DisposeAsync();
        }
    }
}
