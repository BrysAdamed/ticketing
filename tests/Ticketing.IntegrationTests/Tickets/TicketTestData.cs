using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Projects;
using Ticketing.Application.Tickets;
using Ticketing.Domain.Boards;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Tickets;

[CollectionDefinition(nameof(TicketsCollection))]
public sealed class TicketsCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>Arrange helpers for the tickets slice: projects, members and tickets created through the real API.</summary>
public static class TicketTestData
{
    public static async Task<ProjectDto> CreateProjectAsync(this HttpClient client, string key, ProjectVisibility visibility = ProjectVisibility.Private)
    {
        var response = await client.PostAsJsonAsync("/api/v1/projects", new { key, name = $"{key} project", visibility }, HttpAssertions.Json);
        return await response.ReadAsync<ProjectDto>(HttpStatusCode.Created);
    }

    public static Task AddMemberAsync(this TicketingApiFactory api, Guid projectId, TestUser user, ProjectRole role) =>
        api.WithDbAsync(async db =>
        {
            var project = await db.Projects.Include(p => p.Members).SingleAsync(p => p.Id == projectId);
            project.AddMember(user.Id, role, project.CreatedById, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync();
        });

    public static async Task<TicketSummaryDto> CreateTicketAsync(
        this HttpClient client, string projectKey, string title, string type = "UserStory", object? extra = null)
    {
        var body = new Dictionary<string, object?> { ["title"] = title, ["type"] = type };
        if (extra is not null)
        {
            foreach (var property in extra.GetType().GetProperties())
                body[property.Name] = property.GetValue(extra);
        }
        var response = await client.PostAsJsonAsync($"/api/v1/projects/{projectKey}/tickets", body, HttpAssertions.Json);
        return await response.ReadAsync<TicketSummaryDto>(HttpStatusCode.Created);
    }

    public static async Task<TicketDto> PatchTicketAsync(this HttpClient client, string key, object body)
    {
        var response = await client.PatchAsJsonAsync($"/api/v1/tickets/{key}", body, HttpAssertions.Json);
        return await response.ReadAsync<TicketDto>();
    }

    public static async Task<TicketDto> GetTicketAsync(this HttpClient client, string key) =>
        await (await client.GetAsync($"/api/v1/tickets/{key}")).ReadAsync<TicketDto>();

    /// <summary>Creates a board linking <paramref name="projectIds"/> directly in the database (boards are another slice).</summary>
    public static Task<Guid> CreateBoardAsync(this TicketingApiFactory api, Guid ownerId, params Guid[] projectIds) =>
        api.WithDbAsync(async db =>
        {
            var board = Board.Create("Sprint board", null, ownerId, DateTimeOffset.UtcNow);
            foreach (var projectId in projectIds)
                board.LinkProject(projectId, ownerId, DateTimeOffset.UtcNow);
            db.Boards.Add(board);
            await db.SaveChangesAsync();
            return board.Id;
        });

    public static Task PlaceOnBoardAsync(this TicketingApiFactory api, Guid ticketId, Guid boardId, string rank = "a0") =>
        api.WithDbAsync(async db =>
        {
            var ticket = await db.Tickets.SingleAsync(t => t.Id == ticketId);
            ticket.PlaceOnBoard(boardId, rank);
            return await db.SaveChangesAsync();
        });
}
