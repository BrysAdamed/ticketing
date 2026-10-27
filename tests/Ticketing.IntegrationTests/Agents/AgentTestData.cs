using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Agents;
using Ticketing.Domain.Agents;
using Ticketing.Domain.FeatureFlags;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

[CollectionDefinition(nameof(AgentsCollection))]
public sealed class AgentsCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>Arrange helpers for the agent slice: the <c>agent.delegate</c> flag, projects with delegation and tickets.</summary>
internal static class AgentTestData
{
    public const string RepositoryUrl = "https://git.example.com/team/ticketing.git";

    /// <summary>Creates <c>agent.delegate</c>, enabled for the given users and roles only.</summary>
    public static Task EnableAgentFlagAsync(this TicketingApiFactory api, IEnumerable<TestUser> users, params GlobalRole[] roles) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var flag = await db.FeatureFlags.SingleOrDefaultAsync(f => f.Key == AgentFeature.FlagKey);
            if (flag is null)
            {
                flag = FeatureFlag.Create(AgentFeature.FlagKey, "Delegate to agent", null, now);
                db.FeatureFlags.Add(flag);
            }
            flag.Configure(flag.Description, true, 0, users.Select(u => u.Id), roles, null, now);
            await db.SaveChangesAsync();
            api.Services.GetRequiredService<IFeatureFlagStore>().Invalidate();
            return true;
        });

    public static Task EnableAgentFlagAsync(this TicketingApiFactory api, params TestUser[] users) => api.EnableAgentFlagAsync(users, []);

    public static Task<Guid> ProjectAsync(
        this TicketingApiFactory api, TestUser owner, string key, ProjectVisibility visibility = ProjectVisibility.Private, bool delegation = true,
        AgentMergePolicy mergePolicy = AgentMergePolicy.Review, params (TestUser User, ProjectRole Role)[] members) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = Project.Create(key, $"{key} project", null, visibility, owner.Id, now);
            foreach (var (user, role) in members)
                project.AddMember(user.Id, role, owner.Id, now);
            project.ConfigureAgentDelegation(delegation, RepositoryUrl, mergePolicy);
            db.Projects.Add(project);
            await db.SaveChangesAsync();
            return project.Id;
        });

    /// <summary>Adds a ticket and returns its key.</summary>
    public static Task<string> TicketAsync(this TicketingApiFactory api, Guid projectId, TestUser reporter, TicketType type = TicketType.Bug, bool deleted = false) =>
        api.WithDbAsync(async db =>
        {
            var now = DateTimeOffset.UtcNow;
            var project = await db.Projects.SingleAsync(p => p.Id == projectId);
            var number = await db.Tickets.CountAsync(t => t.ProjectId == projectId) + 1;
            var ticket = Ticket.Create(projectId, number, $"Ticket {number}", type, reporter.Id, $"a{number:D4}", now);
            if (deleted)
                ticket.Delete(reporter.Id, now);
            db.Tickets.Add(ticket);
            await db.SaveChangesAsync();
            return $"{project.Key}-{number}";
        });

    public static Task ArchiveAsync(this TicketingApiFactory api, Guid projectId, TestUser owner) =>
        api.WithDbAsync(async db =>
        {
            (await db.Projects.SingleAsync(p => p.Id == projectId)).Archive(owner.Id, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync();
        });

    public static async Task<HttpResponseMessage> PutPromptAsync(this HttpClient client, string projectKey, string type, object body) =>
        await client.PutAsJsonAsync($"/api/v1/projects/{projectKey}/agent/prompts/{type}", body, HttpAssertions.Json);

    public static async Task<HttpResponseMessage> PutInstancePromptAsync(this HttpClient client, string slot, object body) =>
        await client.PutAsJsonAsync($"/api/v1/admin/agent/prompts/{slot}", body, HttpAssertions.Json);

    public static Task<int> PromptActivityCountAsync(this TicketingApiFactory api) =>
        api.WithDbAsync(db => db.ActivityEntries.CountAsync(a => a.Action == AgentPromptDefaults.UpdatedAction));
}
