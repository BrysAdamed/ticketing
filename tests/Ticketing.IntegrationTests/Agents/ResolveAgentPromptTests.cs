using System.Net;
using Ticketing.Application.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.Domain.Users;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

/// <summary>Prompt resolution (spec 13.5), step by step, through the handler; <see cref="GetAgentPromptTests"/> covers its REST and MCP entry points.</summary>
[Collection(nameof(AgentsCollection))]
public sealed class ResolveAgentPromptTests(TicketingApiFactory api)
{
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task With_the_flag_off_resolution_is_agent_disabled()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT"), owner);

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(owner, ticket));

        // Assert
        Assert.Equal((ErrorKind.NotFound, AgentErrors.Disabled), (error.Kind, error.Code));
    }

    [Fact]
    public async Task A_type_without_a_project_row_uses_the_instance_default_followed_by_the_guardrails()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "TKT", members: (viewer, ProjectRole.Viewer));
        var ticket = await api.TicketAsync(projectId, owner);
        await api.EnableAgentFlagAsync(owner, viewer);

        // Act
        var resolved = await ResolveAsync(owner, ticket);
        var asViewer = await ResolveAsync(viewer, ticket);
        var withReadOnlyToken = await ResolveAsync(viewer, ticket, PatScope.ReadOnly);

        // Assert
        Assert.StartsWith($"Fix the bug {ticket}. Reproduce it before you change anything.", resolved.Prompt, StringComparison.Ordinal);
        Assert.Contains($"\n\n<delegation_rules>\nYou were started from the Ticketing tracker at {TicketingApiFactory.PublicUrl} to work on {ticket} (Bug, project TKT): {TicketingApiFactory.PublicUrl}/tickets/{ticket}", resolved.Prompt, StringComparison.Ordinal);
        Assert.Contains($"matches {AgentTestData.RepositoryUrl}", resolved.Prompt, StringComparison.Ordinal);
        Assert.Contains("\"Delegated run · Bug v1 / D\"", resolved.Prompt, StringComparison.Ordinal);
        Assert.DoesNotContain("{{", resolved.Prompt, StringComparison.Ordinal);
        Assert.Equal((ticket, TicketType.Bug, AgentPromptSource.Default, 1, 1), (resolved.TicketKey, resolved.TicketType, resolved.Template.Source, resolved.Template.Version, resolved.GuardrailsVersion));
        Assert.Equal(resolved.Prompt, asViewer.Prompt);
        Assert.Equal(resolved.Prompt, withReadOnlyToken.Prompt);
    }

    [Fact]
    public async Task A_custom_project_template_replaces_the_default()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "TKT");
        var ticket = await api.TicketAsync(projectId, owner, TicketType.Spike);
        await api.EnableAgentFlagAsync(owner);
        await (await (await api.LoginAsync(owner)).PutPromptAsync("TKT", "Spike", new { mode = "Custom", body = "Research {{ticket.key}} ({{template.id}}).", baseVersion = 0 }))
            .ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var resolved = await ResolveAsync(owner, ticket);

        // Assert
        Assert.StartsWith($"Research {ticket} (Spike v1 / C).\n\n<delegation_rules>", resolved.Prompt, StringComparison.Ordinal);
        Assert.Equal((AgentPromptSource.Custom, 1, owner.Id), (resolved.Template.Source, resolved.Template.Version, resolved.Template.UpdatedBy!.Id));
    }

    [Fact]
    public async Task A_type_switched_off_is_agent_type_off()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var projectId = await api.ProjectAsync(owner, "TKT");
        var epic = await api.TicketAsync(projectId, owner, TicketType.Epic);
        var bug = await api.TicketAsync(projectId, owner);
        await api.EnableAgentFlagAsync(owner);
        await (await (await api.LoginAsync(owner)).PutPromptAsync("TKT", "Epic", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(owner, epic));
        var other = await ResolveAsync(owner, bug);

        // Assert
        Assert.Equal((ErrorKind.Conflict, AgentErrors.TypeOff), (error.Kind, error.Code));
        Assert.Equal(AgentPromptSource.Default, other.Template.Source);
    }

    [Fact]
    public async Task A_project_without_delegation_is_agent_project_disabled()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT", delegation: false), owner);
        await api.EnableAgentFlagAsync(owner);

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(owner, ticket));

        // Assert
        Assert.Equal((ErrorKind.Conflict, AgentErrors.ProjectDisabled), (error.Kind, error.Code));
    }

    [Fact]
    public async Task An_archived_project_is_agent_unavailable_and_a_deleted_ticket_is_ticket_deleted()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var archived = await api.ProjectAsync(owner, "OLD");
        var archivedTicket = await api.TicketAsync(archived, owner);
        await api.ArchiveAsync(archived, owner);
        var deletedTicket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT"), owner, deleted: true);
        await api.EnableAgentFlagAsync(owner);

        // Act
        var archivedError = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(owner, archivedTicket));
        var deletedError = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(owner, deletedTicket));

        // Assert
        Assert.Equal((ErrorKind.Conflict, AgentErrors.Unavailable), (archivedError.Kind, archivedError.Code));
        Assert.Equal((ErrorKind.NotFound, TicketErrors.Deleted), (deletedError.Kind, deletedError.Code));
    }

    [Fact]
    public async Task A_private_project_outsider_gets_ticket_not_found()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT"), owner);
        await api.EnableAgentFlagAsync(owner, outsider);

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(outsider, ticket));

        // Assert
        Assert.Equal((ErrorKind.NotFound, TicketErrors.NotFound), (error.Kind, error.Code));
    }

    [Fact]
    public async Task Empty_guardrails_are_not_appended()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var ticket = await api.TicketAsync(await api.ProjectAsync(admin, "TKT"), admin, TicketType.Technical);
        await api.EnableAgentFlagAsync(admin);
        await (await (await api.LoginAsync(admin)).PutInstancePromptAsync("guardrails", new { body = "", baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var resolved = await ResolveAsync(admin, ticket);

        // Assert
        Assert.DoesNotContain("delegation_rules", resolved.Prompt, StringComparison.Ordinal);
        Assert.EndsWith("Do not merge to main: a person reviews and merges.", resolved.Prompt, StringComparison.Ordinal);
        Assert.Equal(2, resolved.GuardrailsVersion);
    }

    [Theory]
    [InlineData(AgentMergePolicy.Review, "Do not merge to main: a person reviews and merges.")]
    [InlineData(AgentMergePolicy.MergeWhenVerified, "Then merge it into main as CLAUDE.md describes")]
    public async Task The_finish_step_follows_the_project_merge_policy(AgentMergePolicy policy, string expected)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT", mergePolicy: policy), owner, TicketType.UserStory);
        await api.EnableAgentFlagAsync(owner);

        // Act
        var resolved = await ResolveAsync(owner, ticket);

        // Assert
        Assert.Contains($"7. Finish: commit with messages that start with the ticket key", resolved.Prompt, StringComparison.Ordinal);
        Assert.Contains(expected, resolved.Prompt, StringComparison.Ordinal);
    }

    [Fact]
    public async Task A_project_prompt_pushed_over_the_limit_by_later_guardrails_is_agent_prompt_too_long()
    {
        // Arrange
        var admin = await api.CreateUserAsync(GlobalRole.Admin);
        var ticket = await api.TicketAsync(await api.ProjectAsync(admin, "TKT"), admin);
        await api.EnableAgentFlagAsync(admin);
        var client = await api.LoginAsync(admin);
        await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "Fix {{ticket.key}}. " + new string('b', 2_600), baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await (await client.PutInstancePromptAsync("guardrails", new { body = new string('r', 2_100), baseVersion = 1 })).ShouldHaveStatusAsync(HttpStatusCode.OK);

        // Act
        var error = await Assert.ThrowsAsync<AppException>(() => ResolveAsync(admin, ticket));

        // Assert
        Assert.Equal((ErrorKind.Conflict, AgentErrors.PromptTooLong), (error.Kind, error.Code));
    }

    private Task<ResolvedAgentPromptDto> ResolveAsync(TestUser user, string ticketKey, PatScope? patScope = null) =>
        api.ExecuteAsAsync(user, sp => sp.GetRequiredService<ResolveAgentPrompt.Handler>().HandleAsync(new ResolveAgentPrompt.Query(ticketKey), _ct), patScope);
}
