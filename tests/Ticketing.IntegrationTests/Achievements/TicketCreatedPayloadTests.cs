using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Achievements;

/// <summary>The <c>ticket.created</c> entry carries <c>assigneeId</c> for <c>triage</c> (D-145), and history still renders it.</summary>
[Collection(nameof(AchievementsCollection))]
public sealed class TicketCreatedPayloadTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Single_and_batch_creation_record_the_assignee_and_history_returns_the_entry()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var assignee = await api.CreateUserAsync();
        var client = await api.LoginAsync(owner);
        var project = await client.CreateProjectAsync("WEB");
        await api.AddMemberAsync(project.Id, assignee, ProjectRole.Member);

        // Act
        var single = await client.CreateTicketAsync("WEB", "Assigned", extra: new { assignee = assignee.Email });
        var unassigned = await client.CreateTicketAsync("WEB", "Unassigned");
        await (await client.PostAsJsonAsync("/api/v1/projects/WEB/tickets/batch",
            new { tickets = new[] { new { title = "Batch", type = "Technical", assignee = assignee.Email } } }, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        var history = await (await client.GetAsync($"/api/v1/tickets/{single.Key}/history", _ct)).ReadAsync<JsonElement>();

        // Assert
        var payloads = await api.WithDbAsync(db => db.ActivityEntries
            .Where(a => a.Action == CreateTicket.Action)
            .ToDictionaryAsync(a => a.EntityId, a => JsonDocument.Parse(a.NewValue!).RootElement.GetProperty("assigneeId")));
        Assert.Equal(assignee.Id, payloads[single.Id].GetGuid());
        Assert.Equal(JsonValueKind.Null, payloads[unassigned.Id].ValueKind);
        Assert.Equal(2, payloads.Values.Count(v => v.ValueKind == JsonValueKind.String && v.GetGuid() == assignee.Id));
        var created = Assert.Single(history.GetProperty("items").EnumerateArray(), i => i.GetProperty("action").GetString() == CreateTicket.Action);
        Assert.Equal(assignee.Id, created.GetProperty("newValue").GetProperty("assigneeId").GetGuid());
    }
}
