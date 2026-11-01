using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Ticketing.Application.Common;
using Ticketing.Domain.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

/// <summary>D-43, D-175: an edit without If-Match is last-writer-wins, so a write of the same ticket committing while it runs cannot fail it.</summary>
[Collection(nameof(TicketsCollection))]
public sealed class UpdateTicketRaceTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Theory]
    [InlineData("priority")]
    [InlineData("status")]
    [InlineData("title")]
    public async Task An_edit_without_if_match_succeeds_when_another_write_of_the_ticket_commits_while_it_runs(string field)
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Before");
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var other = await connection.BeginTransactionAsync(_ct);
        await using (var update = new NpgsqlCommand(
            "UPDATE tickets SET story_points = 5, rank = rank WHERE id = @id", connection, other))
        {
            update.Parameters.AddWithValue("id", ticket.Id);
            Assert.Equal(1, await update.ExecuteNonQueryAsync(_ct));
        }

        // Act
        object patch = field switch
        {
            "priority" => new { priority = "High" },
            "status" => new { status = "InProgress" },
            _ => new { title = "After" },
        };
        var edit = client.PatchAsJsonAsync($"/api/v1/tickets/{ticket.Key}", patch, _ct);
        await api.UntilSomeoneWaitsAsync(_ct);
        await other.CommitAsync(_ct);
        var response = await edit;

        // Assert
        Assert.True(response.IsSuccessStatusCode, $"PATCH {field} answered {(int)response.StatusCode}: {await response.Content.ReadAsStringAsync(_ct)}");
        var stored = await api.WithDbAsync(db => db.Tickets.AsNoTracking().SingleAsync(t => t.Id == ticket.Id, _ct));
        Assert.Equal(5, stored.StoryPoints);
        switch (field)
        {
            case "priority":
                Assert.Equal(Priority.High, stored.Priority);
                break;
            case "status":
                Assert.Equal(TicketStatus.InProgress, stored.Status);
                break;
            default:
                Assert.Equal("After", stored.Title);
                break;
        }
    }

    [Fact]
    public async Task Two_parallel_inline_edits_of_one_ticket_both_land()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Task");

        // Act
        var responses = await Task.WhenAll(
            Enumerable.Range(0, 10).Select(i => client.PatchAsJsonAsync(
                $"/api/v1/tickets/{ticket.Key}",
                i % 2 == 0 ? new { priority = "High" } : (object)new { status = "InProgress" },
                _ct)));

        // Assert
        Assert.All(responses, r => Assert.Equal(HttpStatusCode.OK, r.StatusCode));
        var stored = await client.GetTicketAsync(ticket.Key);
        Assert.Equal(Priority.High, stored.Priority);
        Assert.Equal(TicketStatus.InProgress, stored.Status);
    }

    [Fact]
    public async Task An_edit_with_the_if_match_read_before_another_write_committed_still_returns_409()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        await client.CreateProjectAsync("WEB");
        var ticket = await client.CreateTicketAsync("WEB", "Before");
        await using var connection = new NpgsqlConnection(api.ConnectionString);
        await connection.OpenAsync(_ct);
        await using var other = await connection.BeginTransactionAsync(_ct);
        await using (var update = new NpgsqlCommand("UPDATE tickets SET title = 'Theirs' WHERE id = @id", connection, other))
        {
            update.Parameters.AddWithValue("id", ticket.Id);
            Assert.Equal(1, await update.ExecuteNonQueryAsync(_ct));
        }
        var request = new HttpRequestMessage(HttpMethod.Patch, $"/api/v1/tickets/{ticket.Key}")
        {
            Content = JsonContent.Create(new { title = "Mine" }),
            Headers = { { "If-Match", $"\"{ticket.RowVersion}\"" } },
        };

        // Act
        var edit = client.SendAsync(request, _ct);
        await api.UntilSomeoneWaitsAsync(_ct);
        await other.CommitAsync(_ct);
        var response = await edit;

        // Assert
        await response.ShouldBeProblemAsync(HttpStatusCode.Conflict, AppErrors.ConcurrencyConflict);
        var stored = await api.WithDbAsync(db => db.Tickets.AsNoTracking().SingleAsync(t => t.Id == ticket.Id, _ct));
        Assert.Equal("Theirs", stored.Title);
    }
}
