using System.Net;
using System.Net.Http.Json;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Agents;
using Ticketing.Application.Onboarding;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Agents;
using Ticketing.IntegrationTests.Boards;
using Ticketing.IntegrationTests.Infrastructure;
using Ticketing.IntegrationTests.Mentions;
using Ticketing.IntegrationTests.Testing;
using Items = Ticketing.Application.Onboarding.OnboardingChecklistItems;

namespace Ticketing.IntegrationTests.Onboarding;

[Collection(nameof(OnboardingCollection))]
public sealed class OnboardingChecklistTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_user_without_projects_gets_only_the_items_everyone_sees_none_done()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var checklist = await client.ChecklistAsync(_ct);

        // Assert
        Assert.Equal(
            [(Items.FollowTicket, false, false), (Items.AgentToken, false, true), (Items.AgentConnected, false, true)],
            checklist.Select(i => (i.Id, i.Done, i.Optional)));
    }

    [Fact]
    public async Task The_write_items_tick_off_after_the_real_actions_in_the_web_app()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var project = await owner.CreateProjectAsync("WEB");
        var member = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        var client = await api.LoginAsync(member);
        var before = await client.ChecklistAsync(_ct);

        // Act
        var key = await client.CreateStoryAsync("WEB");
        var afterCreate = await client.ChecklistAsync(_ct);
        await (await client.PatchAsJsonAsync($"/api/v1/tickets/{key}", new { status = "InProgress" }, HttpAssertions.Json, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await client.AddCommentAsync(key, "On it.");
        await (await client.PutAsync($"/api/v1/tickets/{key}/watchers/me", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var after = await client.ChecklistAsync(_ct);

        // Assert
        Assert.Equal([Items.CreateTicket, Items.MoveWork, Items.JoinConversation, Items.FollowTicket, Items.AgentToken, Items.AgentConnected], before.Select(i => i.Id));
        Assert.All(before, i => Assert.False(i.Done));
        Assert.Equal([Items.CreateTicket, Items.FollowTicket], afterCreate.Where(i => i.Done).Select(i => i.Id));
        Assert.Equal([Items.CreateTicket, Items.MoveWork, Items.JoinConversation, Items.FollowTicket], after.Where(i => i.Done).Select(i => i.Id));
    }

    [Fact]
    public async Task The_same_items_tick_off_when_an_agent_works_over_mcp()
    {
        // Arrange
        var user = await api.CreateUserAsync();
        var browser = await api.LoginAsync(user);
        await browser.CreateProjectAsync("MCP");
        var token = await api.CreatePatAsync(user);
        var tokenOnly = await browser.ChecklistAsync(_ct);
        await using var mcp = await api.CreateMcpClientAsync(token);

        // Act
        var created = await CallAsync(mcp, "create_ticket", new() { ["projectKey"] = "MCP", ["title"] = "From the agent", ["type"] = "Technical" });
        var key = created.GetProperty("key").GetString()!;
        await CallAsync(mcp, "update_ticket", new() { ["key"] = key, ["status"] = "Review" });
        await CallAsync(mcp, "add_comment", new() { ["key"] = key, ["body"] = "Done by the agent." });
        await CallAsync(mcp, "watch_ticket", new() { ["key"] = key });
        var after = await browser.ChecklistAsync(_ct);

        // Assert
        Assert.Equal([Items.AgentToken], tokenOnly.Where(i => i.Done).Select(i => i.Id));
        Assert.All(after.Where(i => i.Id is Items.CreateTicket or Items.MoveWork or Items.JoinConversation or Items.FollowTicket or Items.AgentToken or Items.AgentConnected),
            i => Assert.True(i.Done, i.Id));
    }

    [Fact]
    public async Task A_revoked_token_no_longer_counts_as_an_active_one()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var created = await (await client.PostAsJsonAsync("/api/v1/me/tokens", new { name = "Claude Code" }, HttpAssertions.Json, _ct))
            .ReadAsync<System.Text.Json.JsonElement>(HttpStatusCode.Created);
        var active = await client.ChecklistAsync(_ct);

        // Act
        var tokenId = created.GetProperty("token").GetProperty("id").GetGuid();
        await (await client.PostAsync($"/api/v1/me/tokens/{tokenId}/revoke", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var revoked = await client.ChecklistAsync(_ct);

        // Assert
        Assert.True(active.Single(i => i.Id == Items.AgentToken).Done);
        Assert.False(revoked.Single(i => i.Id == Items.AgentToken).Done);
    }

    [Fact]
    public async Task Owner_items_tick_off_after_inviting_planning_testing_and_running_a_regression()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());
        var teammate = await api.CreateUserAsync();
        await client.CreateProjectAsync("OWN");
        var before = await client.ChecklistAsync(_ct);

        // Act
        await (await client.PostAsJsonAsync("/api/v1/projects/OWN/members", new { user = teammate.Email, role = "Member" }, HttpAssertions.Json, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        await client.CreateBoardAsync("Sprint 1", "OWN");
        await client.CreateManualCaseAsync("OWN", "Sign in");
        await client.StartSessionAsync("OWN");
        var after = await client.ChecklistAsync(_ct);

        // Assert
        Assert.Equal(
            [Items.CreateTicket, Items.MoveWork, Items.JoinConversation, Items.FollowTicket, Items.InviteTeam, Items.PlanOnBoard, Items.WriteTestCase,
                Items.RunRegression, Items.AgentToken, Items.AgentConnected],
            before.Select(i => i.Id));
        Assert.All(before, i => Assert.False(i.Done));
        Assert.Equal([Items.InviteTeam, Items.PlanOnBoard, Items.WriteTestCase, Items.RunRegression], after.Where(i => i.Done).Select(i => i.Id));
    }

    [Fact]
    public async Task Owning_a_public_project_counts_as_having_invited_the_team()
    {
        // Arrange
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        await client.CreateProjectAsync("OPEN", ProjectVisibility.Public);
        var checklist = await client.ChecklistAsync(_ct);

        // Assert
        Assert.True(checklist.Single(i => i.Id == Items.InviteTeam).Done);
    }

    [Fact]
    public async Task Members_and_owners_of_archived_projects_get_no_owner_items()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var project = await owner.CreateProjectAsync("ARCH");
        var member = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, member, ProjectRole.Member);
        var memberClient = await api.LoginAsync(member);
        var memberChecklist = await memberClient.ChecklistAsync(_ct);

        // Act
        await api.ArchiveProjectAsync(project.Id);
        var ownerChecklist = await owner.ChecklistAsync(_ct);

        // Assert
        Assert.DoesNotContain(memberChecklist, i => i.Id == Items.InviteTeam);
        Assert.Equal([Items.FollowTicket, Items.AgentToken, Items.AgentConnected], ownerChecklist.Select(i => i.Id));
    }

    [Fact]
    public async Task A_viewer_everywhere_sees_no_write_items_but_can_follow_a_ticket()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        var project = await owner.CreateProjectAsync("VIEW");
        var key = await owner.CreateStoryAsync("VIEW");
        var viewer = await api.CreateUserAsync();
        await api.AddMemberAsync(project.Id, viewer, ProjectRole.Viewer);
        var client = await api.LoginAsync(viewer);

        // Act
        await (await client.PutAsync($"/api/v1/tickets/{key}/watchers/me", null, _ct)).ShouldHaveStatusAsync(HttpStatusCode.OK);
        var onboarding = await (await client.GetAsync("/api/v1/me/onboarding", _ct)).ReadAsync<OnboardingDto>();

        // Assert
        Assert.False(onboarding.OwnsProjects);
        Assert.Equal(
            [(Items.FollowTicket, true), (Items.AgentToken, false), (Items.AgentConnected, false)],
            onboarding.Checklist.Select(i => (i.Id, i.Done)));
    }

    [Fact]
    public async Task Any_public_project_makes_a_user_a_writer()
    {
        // Arrange
        var owner = await api.LoginAsync(await api.CreateUserAsync());
        await owner.CreateProjectAsync("PUBW", ProjectVisibility.Public);
        var client = await api.LoginAsync(await api.CreateUserAsync());

        // Act
        var checklist = await client.ChecklistAsync(_ct);

        // Assert
        Assert.Contains(checklist, i => i.Id == Items.CreateTicket);
        Assert.DoesNotContain(checklist, i => i.Id == Items.InviteTeam);
    }

    [Fact]
    public async Task Admin_items_appear_only_for_admins_and_tick_off_after_adding_a_teammate_and_a_project()
    {
        // Arrange
        var admin = await api.LoginAsync(await api.CreateUserAsync(GlobalRole.Admin));
        var user = await api.LoginAsync(await api.CreateUserAsync());
        var before = await admin.ChecklistAsync(_ct);

        // Act
        await (await admin.PostAsJsonAsync("/api/v1/admin/users", new { email = "new.teammate@ticketing.test", displayName = "New teammate" }, HttpAssertions.Json, _ct))
            .ShouldHaveStatusAsync(HttpStatusCode.Created);
        await user.CreateProjectAsync("FIRST");
        var after = await admin.ChecklistAsync(_ct);
        var userChecklist = await user.ChecklistAsync(_ct);

        // Assert
        Assert.Equal([Items.FollowTicket, Items.AddTeammate, Items.FirstProject, Items.AgentToken, Items.AgentConnected], before.Select(i => i.Id));
        Assert.All(before, i => Assert.False(i.Done));
        Assert.Equal([Items.AddTeammate, Items.FirstProject], after.Where(i => i.Done).Select(i => i.Id));
        Assert.DoesNotContain(userChecklist, i => i.Id is Items.AddTeammate or Items.FirstProject or Items.EnableDelegation);
    }

    [Fact]
    public async Task Enable_agent_delegation_is_offered_to_admins_with_the_flag_and_done_when_the_public_url_is_set()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var flaggedUser = await api.CreateUserAsync();
        var otherAdmin = await api.CreateUserAsync(GlobalRole.Admin);
        await api.EnableAgentFlagAsync(admin, flaggedUser);
        var client = await api.LoginAsync(admin);
        var options = api.Services.GetRequiredService<IOptions<AgentOptions>>().Value;
        var publicUrl = options.PublicUrl;

        // Act
        var configured = await client.ChecklistAsync(_ct);
        options.PublicUrl = null;
        List<OnboardingChecklistItemDto> unconfigured;
        try
        {
            unconfigured = await client.ChecklistAsync(_ct);
        }
        finally
        {
            options.PublicUrl = publicUrl;
        }
        var user = await (await api.LoginAsync(flaggedUser)).ChecklistAsync(_ct);
        var adminWithoutFlag = await (await api.LoginAsync(otherAdmin)).ChecklistAsync(_ct);

        // Assert
        Assert.True(configured.Single(i => i.Id == Items.EnableDelegation).Done);
        Assert.False(unconfigured.Single(i => i.Id == Items.EnableDelegation).Done);
        Assert.DoesNotContain(user, i => i.Id == Items.EnableDelegation);
        Assert.DoesNotContain(adminWithoutFlag, i => i.Id == Items.EnableDelegation);
    }

    private async Task<System.Text.Json.JsonElement> CallAsync(McpClient mcp, string tool, Dictionary<string, object?> arguments)
    {
        var result = await mcp.CallToolAsync(tool, arguments, cancellationToken: _ct);
        Assert.False(result.IsError == true, $"{tool} failed: {(result.Content.FirstOrDefault() as TextContentBlock)?.Text}");
        return System.Text.Json.JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
    }
}

internal static class OnboardingChecklistTestData
{
    public static async Task<List<OnboardingChecklistItemDto>> ChecklistAsync(this HttpClient client, CancellationToken cancellationToken) =>
        [.. (await (await client.GetAsync("/api/v1/me/onboarding", cancellationToken)).ReadAsync<OnboardingDto>()).Checklist];
}
