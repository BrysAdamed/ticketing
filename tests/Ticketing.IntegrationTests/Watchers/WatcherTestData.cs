using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Watchers;
using Ticketing.Domain.Projects;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Tickets;

namespace Ticketing.IntegrationTests.Watchers;

[CollectionDefinition(nameof(WatchersCollection))]
public sealed class WatchersCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>A project with one user per role, each with a signed-in browser client.</summary>
public sealed record WatcherWorld(
    TestUser Owner, HttpClient OwnerClient, TestUser Member, HttpClient MemberClient, TestUser Viewer, HttpClient ViewerClient, Guid ProjectId);

public static class WatcherTestData
{
    public static async Task<WatcherWorld> SeedWorldAsync(this TicketingApiFactory api, string key = "WEB", ProjectVisibility visibility = ProjectVisibility.Private)
    {
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync(displayName: "Member Mia");
        var viewer = await api.CreateUserAsync(displayName: "Viewer Vic");
        var ownerClient = await api.LoginAsync(owner);
        var project = await ownerClient.CreateProjectAsync(key, visibility);
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        return new WatcherWorld(owner, ownerClient, member, await api.LoginAsync(member), viewer, await api.LoginAsync(viewer), project.Id);
    }

    public static async Task<WatchersDto> WatchersAsync(this HttpClient client, string key) =>
        await (await client.GetAsync($"/api/v1/tickets/{key}/watchers")).ReadAsync<WatchersDto>();

    public static async Task<WatchersDto> WatchAsync(this HttpClient client, string key) =>
        await (await client.PutAsync($"/api/v1/tickets/{key}/watchers/me", null)).ReadAsync<WatchersDto>();

    public static async Task<WatchersDto> UnwatchAsync(this HttpClient client, string key) =>
        await (await client.DeleteAsync($"/api/v1/tickets/{key}/watchers/me")).ReadAsync<WatchersDto>();

    public static async Task CommentAsync(this HttpClient client, string key, string body = "Looks good")
    {
        var response = await client.PostAsJsonAsync($"/api/v1/tickets/{key}/comments", new { body });
        await response.ShouldHaveStatusAsync(HttpStatusCode.Created);
    }

    /// <summary>The stored watcher rows of a ticket, hidden ones included.</summary>
    public static Task<List<Guid>> StoredWatcherIdsAsync(this TicketingApiFactory api, Guid ticketId) =>
        api.WithDbAsync(db => db.TicketWatchers.Where(w => w.TicketId == ticketId).Select(w => w.UserId).OrderBy(id => id).ToListAsync());

    public static List<Guid> Ids(this WatchersDto watchers) => [.. watchers.Users.Select(u => u.Id)];

    public static List<Guid> Sorted(params TestUser[] users) => [.. users.Select(u => u.Id).OrderBy(id => id)];
}
