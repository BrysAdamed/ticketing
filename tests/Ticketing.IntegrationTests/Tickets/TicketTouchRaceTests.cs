using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ticketing.Application.Comments;
using Ticketing.Application.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

/// <summary>D-165: comments and links touch their ticket without its row version, so a parallel edit cannot fail them.</summary>
[Collection(nameof(TicketsCollection))]
public sealed class TicketTouchRaceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("add comment")]
    [InlineData("edit comment")]
    [InlineData("delete comment")]
    [InlineData("link")]
    [InlineData("unlink")]
    public async Task A_side_write_succeeds_when_a_rename_of_the_ticket_commits_while_it_runs(string sideWrite)
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Before");
        var other = await client.CreateTicketAsync("WEB", "Other");
        var comment = await (await client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "first" }, _ct))
            .ReadAsync<CommentDto>(HttpStatusCode.Created);
        var link = await (await client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/links", new { targetKey = other.Key, type = "Blocks" }, _ct))
            .ReadAsync<TicketLinkDto>(HttpStatusCode.Created);
        var renamedAt = DateTimeOffset.UtcNow.AddHours(1);
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var rename = await connection.BeginTransactionAsync(_ct);
        await using (var update = new NpgsqlCommand(
            "UPDATE tickets SET title = 'After', updated_at = @at WHERE id = @id", connection, rename))
        {
            update.Parameters.AddWithValue("at", renamedAt);
            update.Parameters.AddWithValue("id", ticket.Id);
            Assert.Equal(1, await update.ExecuteNonQueryAsync(_ct));
        }

        // Act
        var write = sideWrite switch
        {
            "add comment" => client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "second" }, _ct),
            "edit comment" => client.PatchAsJsonAsync($"/api/v1/comments/{comment.Id}", new { body = "edited" }, _ct),
            "delete comment" => client.DeleteAsync($"/api/v1/comments/{comment.Id}", _ct),
            "link" => client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/links", new { targetKey = other.Key, type = "RelatesTo" }, _ct),
            _ => client.DeleteAsync($"/api/v1/tickets/{ticket.Key}/links/{link.Id}", _ct),
        };
        await api.UntilSomeoneWaitsAsync(_ct);
        await rename.CommitAsync(_ct);
        var response = await write;

        // Assert
        Assert.True(response.IsSuccessStatusCode, $"{sideWrite} answered {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(_ct)}");
        var stored = await api.WithDbAsync(db => db.Tickets.AsNoTracking().SingleAsync(t => t.Id == ticket.Id, _ct));
        Assert.Equal("After", stored.Title);
        Assert.Equal(renamedAt.ToUnixTimeMilliseconds(), stored.UpdatedAt.ToUnixTimeMilliseconds());
    }

    [Fact]
    public async Task A_comment_bumps_the_ticket_updated_at_and_row_version()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");
        var before = await client.GetTicketAsync(ticket.Key);

        // Act
        await (await client.PostAsJsonAsync($"/api/v1/tickets/{ticket.Key}/comments", new { body = "hello" }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);

        // Assert
        var after = await client.GetTicketAsync(ticket.Key);
        Assert.True(after.UpdatedAt > before.UpdatedAt);
        Assert.NotEqual(before.RowVersion, after.RowVersion);
    }
}
