using System.Net;
using System.Net.Http.Json;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Projects;
using Ticketing.Application.Regressions;
using Ticketing.Application.TestCases;
using Ticketing.Domain.Projects;
using Ticketing.Application.Tickets;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Testing;

[CollectionDefinition(nameof(TestingCollection))]
public sealed class TestingCollection : ICollectionFixture<TicketingApiFactory>;

/// <summary>Arrange helpers for the test cases and regressions slice.</summary>
public static class TestingTestData
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

    public static Task ArchiveProjectAsync(this TicketingApiFactory api, Guid projectId) =>
        api.WithDbAsync(async db =>
        {
            var project = await db.Projects.SingleAsync(p => p.Id == projectId);
            project.Archive(project.CreatedById, DateTimeOffset.UtcNow);
            return await db.SaveChangesAsync();
        });

    /// <summary>Creates a user story through the tickets API and returns its key.</summary>
    public static async Task<string> CreateStoryAsync(this HttpClient client, string projectKey, string title = "Login page")
    {
        var response = await client.PostAsJsonAsync($"/api/v1/projects/{projectKey}/tickets", new { title, type = "UserStory" }, HttpAssertions.Json);
        return (await response.ReadAsync<TicketSummaryDto>(HttpStatusCode.Created)).Key;
    }

    public static async Task<TestCaseDto> CreateTestCaseAsync(this HttpClient client, string projectKey, string title, object? extra = null)
    {
        var body = new Dictionary<string, object?> { ["title"] = title };
        if (extra is not null)
        {
            foreach (var property in extra.GetType().GetProperties())
                body[property.Name] = property.GetValue(extra);
        }
        var response = await client.PostAsJsonAsync($"/api/v1/projects/{projectKey}/test-cases", body, HttpAssertions.Json);
        return await response.ReadAsync<TestCaseDto>(HttpStatusCode.Created);
    }

    public static Task<TestCaseDto> CreateManualCaseAsync(this HttpClient client, string projectKey, string title) =>
        client.CreateTestCaseAsync(projectKey, title, new { status = "Manual", steps = new[] { "Open the page", "Press the button" } });

    public static Task<TestCaseDto> CreateAutomaticCaseAsync(this HttpClient client, string projectKey, string title) =>
        client.CreateTestCaseAsync(projectKey, title, new { status = "Automatic", automationReference = "tests/login.spec.ts" });

    public static async Task<RegressionSessionDto> StartSessionAsync(this HttpClient client, string projectKey, object? body = null)
    {
        var response = await client.PostAsJsonAsync($"/api/v1/projects/{projectKey}/regression-sessions", body ?? new { }, HttpAssertions.Json);
        return await response.ReadAsync<RegressionSessionDto>(HttpStatusCode.Created);
    }

    public static Task<HttpResponseMessage> RecordAsync(this HttpClient client, string sessionKey, string testCaseKey, string status, string? note = null) =>
        client.PostAsJsonAsync($"/api/v1/regression-sessions/{sessionKey}/items/{testCaseKey}/result", new { status, note }, HttpAssertions.Json);

    public static Task<HttpResponseMessage> TakeAsync(this HttpClient client, string sessionKey, string testCaseKey) =>
        client.PostAsync($"/api/v1/regression-sessions/{sessionKey}/items/{testCaseKey}/take", null);

    public static async Task<RegressionSessionDto> GetSessionAsync(this HttpClient client, string sessionKeyAndQuery) =>
        await (await client.GetAsync($"/api/v1/regression-sessions/{sessionKeyAndQuery}")).ReadAsync<RegressionSessionDto>();
}
