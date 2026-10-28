using System.Net;
using System.Net.Http.Json;
using Ticketing.Application.Onboarding;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Testing;
using Items = Ticketing.Application.Onboarding.OnboardingChecklistItems;

namespace Ticketing.IntegrationTests.Onboarding;

/// <summary>
/// Copy of <see cref="Projects.ReadableProjectsLeakGuardTests"/> for the getting-started checklist (spec 14.3): every item
/// query is composed with <c>ReadableProjects()</c>, so work done in a project the user can no longer read (private and
/// left, or deleted) never ticks an item off.
/// </summary>
[Collection(nameof(OnboardingCollection))]
public sealed class OnboardingChecklistLeakGuardTests(TicketingApiFactory api)
{
    private static readonly string[] WriteItems = [Items.CreateTicket, Items.MoveWork, Items.JoinConversation, Items.FollowTicket];
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Checklist_queries_composed_with_readable_projects_ignore_work_in_unreadable_projects()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var member = await api.CreateUserAsync();
        var ghost = await api.CreateUserAsync();
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var ownerClient = await api.LoginAsync(owner);
        var memberClient = await api.LoginAsync(member);
        var ghostClient = await api.LoginAsync(ghost);
        var priv = await ownerClient.CreateProjectAsync("PRIV");
        await ownerClient.CreateProjectAsync("PUB", ProjectVisibility.Public);
        await api.AddMemberAsync(priv.Id, member, ProjectRole.Member);
        await DoEverythingAsync(memberClient, "PRIV");
        await ghostClient.CreateProjectAsync("GONE", ProjectVisibility.Public);
        await DoEverythingAsync(ghostClient, "GONE");
        await ghostClient.CreateManualCaseAsync("GONE", "Sign in");
        var memberBefore = await memberClient.ChecklistAsync(_ct);
        var ghostBefore = await ghostClient.ChecklistAsync(_ct);

        // Act
        await (await ownerClient.DeleteAsync($"/api/v1/projects/PRIV/members/{member.Id}", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        await (await admin.PostAsync("/api/v1/projects/GONE/archive", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await admin.DeleteAsync("/api/v1/projects/GONE?confirmKey=GONE", _ct)).ShouldHaveStatusAsync(HttpStatusCode.NoContent);
        var memberAfter = await memberClient.ChecklistAsync(_ct);
        var ghostAfter = await (await ghostClient.GetAsync("/api/v1/me/onboarding", _ct)).ReadAsync<OnboardingDto>();

        // Assert
        Assert.All(WriteItems, id => Assert.True(memberBefore.Single(i => i.Id == id).Done, id));
        Assert.True(ghostBefore.Single(i => i.Id == Items.WriteTestCase).Done);
        Assert.All(WriteItems, id => Assert.False(memberAfter.Single(i => i.Id == id).Done, id));
        Assert.All(WriteItems, id => Assert.False(ghostAfter.Checklist.Single(i => i.Id == id).Done, id));
        Assert.False(ghostAfter.OwnsProjects);
        Assert.DoesNotContain(ghostAfter.Checklist, i => i.Id == Items.WriteTestCase);
    }

    private async Task DoEverythingAsync(HttpClient client, string projectKey)
    {
        var key = await client.CreateStoryAsync(projectKey);
        await (await client.PatchAsJsonAsync($"/api/v1/tickets/{key}", new { status = "InProgress" }, HttpAssertions.Json, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await client.AddCommentAsync(key, "Looking.");
        await (await client.PutAsync($"/api/v1/tickets/{key}/watchers/me", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
    }
}
