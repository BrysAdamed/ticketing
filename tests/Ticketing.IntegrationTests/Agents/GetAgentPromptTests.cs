using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using ModelContextProtocol.Client;
using ModelContextProtocol.Protocol;
using Ticketing.Application.Agents;
using Ticketing.Domain.Agents;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Tickets;
using Ticketing.Domain.Tokens;
using Ticketing.IntegrationTests.Infrastructure;

namespace Ticketing.IntegrationTests.Agents;

/// <summary>
/// <c>GET /tickets/{key}/agent-prompt</c> and MCP <c>get_agent_prompt</c> (spec 13.5, 13.9): one handler, the same prompt,
/// readable by everyone who can read the ticket, invisible while the agent gate is closed.
/// </summary>
[Collection(nameof(AgentsCollection))]
public sealed class GetAgentPromptTests(TicketingApiFactory api)
{
    private const string Tool = "get_agent_prompt";
    private readonly CancellationToken _ct = TestContext.Current.CancellationToken;

    [Fact]
    public async Task Rest_and_mcp_return_the_same_prompt_to_owners_viewers_and_read_only_tokens()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var viewer = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT", members: (viewer, ProjectRole.Viewer)), owner);
        await api.EnableAgentFlagAsync(owner, viewer);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(viewer, PatScope.ReadOnly));

        // Act
        var asOwner = await (await (await api.LoginAsync(owner)).GetAsync(Path(ticket), _ct)).ReadAsync<JsonElement>();
        var asViewer = await (await (await api.LoginAsync(viewer)).GetAsync(Path(ticket), _ct)).ReadAsync<JsonElement>();
        var withReadOnlyPat = await (await api.CreatePatClientAsync(viewer, PatScope.ReadOnly)).GetAsync(Path(ticket), _ct);
        var overMcp = await mcp.CallToolAsync(Tool, new Dictionary<string, object?> { ["key"] = ticket.ToLowerInvariant() }, cancellationToken: _ct);

        // Assert
        var prompt = asOwner.GetProperty("prompt").GetString();
        Assert.StartsWith($"Fix the bug {ticket}.", prompt, StringComparison.Ordinal);
        Assert.Equal((ticket, "Bug", "Default", 1), (asOwner.GetProperty("ticketKey").GetString(), asOwner.GetProperty("ticketType").GetString(),
            asOwner.GetProperty("template").GetProperty("source").GetString(), asOwner.GetProperty("template").GetProperty("version").GetInt32()));
        Assert.Equal(1, asOwner.GetProperty("guardrailsVersion").GetInt32());
        Assert.Equal(prompt, asViewer.GetProperty("prompt").GetString());
        Assert.Equal(prompt, (await withReadOnlyPat.ReadAsync<JsonElement>()).GetProperty("prompt").GetString());
        Assert.NotEqual(true, overMcp.IsError);
        var mcpPayload = Payload(overMcp);
        Assert.Equal(prompt, mcpPayload.GetProperty("prompt").GetString());
        Assert.Equal((ticket, "Default", 1), (mcpPayload.GetProperty("ticketKey").GetString(),
            mcpPayload.GetProperty("template").GetProperty("source").GetString(), mcpPayload.GetProperty("guardrailsVersion").GetInt32()));
    }

    [Fact]
    public async Task A_private_project_outsider_gets_ticket_not_found_over_rest_and_mcp()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var outsider = await api.CreateUserAsync();
        var privateTicket = await api.TicketAsync(await api.ProjectAsync(owner, "PRIV"), owner);
        var publicTicket = await api.TicketAsync(await api.ProjectAsync(owner, "PUB", ProjectVisibility.Public), owner);
        await api.EnableAgentFlagAsync(owner, outsider);
        var client = await api.LoginAsync(outsider);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(outsider));

        // Act
        var hidden = await client.GetAsync(Path(privateTicket), _ct);
        var missing = await client.GetAsync(Path("PRIV-999"), _ct);
        var visible = await client.GetAsync(Path(publicTicket), _ct);
        var overMcp = await mcp.CallToolAsync(Tool, new Dictionary<string, object?> { ["key"] = privateTicket }, cancellationToken: _ct);

        // Assert
        var hiddenProblem = await hidden.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        var missingProblem = await missing.ShouldBeProblemAsync(HttpStatusCode.NotFound, TicketErrors.NotFound);
        Assert.Equal(missingProblem.GetProperty("type").GetString(), hiddenProblem.GetProperty("type").GetString());
        await visible.ShouldHaveStatusAsync(HttpStatusCode.OK);
        Assert.True(overMcp.IsError);
        Assert.Equal(TicketErrors.NotFound, Payload(overMcp).GetProperty("code").GetString());
    }

    [Fact]
    public async Task Resolution_errors_surface_with_their_codes()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var disabled = await api.TicketAsync(await api.ProjectAsync(owner, "OFF", delegation: false), owner);
        var enabled = await api.ProjectAsync(owner, "TKT");
        var epic = await api.TicketAsync(enabled, owner, TicketType.Epic);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await (await client.PutPromptAsync("TKT", "Epic", new { mode = "Off", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner));

        // Act
        var projectOff = await client.GetAsync(Path(disabled), _ct);
        var typeOff = await mcp.CallToolAsync(Tool, new Dictionary<string, object?> { ["key"] = epic }, cancellationToken: _ct);

        // Assert
        await projectOff.ShouldBeProblemAsync(HttpStatusCode.Conflict, AgentErrors.ProjectDisabled);
        Assert.Equal(AgentErrors.TypeOff, Payload(typeOff).GetProperty("code").GetString());
    }

    [Theory]
    [InlineData(AgentPromptScope.Project, "project's Agent settings")]
    [InlineData(AgentPromptScope.Instance, "Admin → Agent prompts")]
    public async Task A_stored_template_that_no_longer_parses_is_agent_template_invalid_over_rest_and_mcp(AgentPromptScope corrupted, string fixHere)
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT"), owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await (await client.PutPromptAsync("TKT", "Bug", new { mode = "Custom", body = "Fix {{ticket.key}}.", baseVersion = 0 })).ShouldHaveStatusAsync(HttpStatusCode.OK);
        TicketType? slot = corrupted == AgentPromptScope.Project ? TicketType.Bug : null;
        await api.WithDbAsync(db => db.AgentPromptTemplates
            .Where(t => t.Scope == corrupted && t.TicketType == slot)
            .ExecuteUpdateAsync(s => s.SetProperty(t => t.Body, "Fix {{ticket.key}}.\n{{ticket.retired}}"), _ct));
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner));

        // Act
        var overRest = await client.GetAsync(Path(ticket), _ct);
        var overMcp = await mcp.CallToolAsync(Tool, new Dictionary<string, object?> { ["key"] = ticket }, cancellationToken: _ct);

        // Assert
        var problem = await overRest.ShouldBeProblemAsync(HttpStatusCode.Conflict, AgentErrors.TemplateInvalid);
        Assert.Contains("line 2, column 1", problem.GetProperty("title").GetString(), StringComparison.Ordinal);
        Assert.DoesNotContain("ticket.retired", problem.GetRawText(), StringComparison.Ordinal);
        Assert.Contains(fixHere, problem.GetProperty("hint").GetString(), StringComparison.Ordinal);
        Assert.True(overMcp.IsError);
        var payload = Payload(overMcp);
        Assert.Equal(AgentErrors.TemplateInvalid, payload.GetProperty("code").GetString());
        Assert.Contains(fixHere, payload.GetProperty("hint").GetString(), StringComparison.Ordinal);
    }

    [Fact]
    public async Task Tools_list_shows_get_agent_prompt_only_to_users_the_flag_is_on_for()
    {
        // Arrange
        var targeted = await api.CreateUserAsync();
        var other = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(targeted, "TKT", ProjectVisibility.Public), targeted);
        await api.EnableAgentFlagAsync(targeted);
        await using var on = await api.CreateMcpClientAsync(await api.CreatePatAsync(targeted, PatScope.ReadOnly));
        await using var off = await api.CreateMcpClientAsync(await api.CreatePatAsync(other));

        // Act
        var onTools = await ToolNamesAsync(on);
        var offTools = await ToolNamesAsync(off);
        var called = await off.CallToolAsync(Tool, new Dictionary<string, object?> { ["key"] = ticket }, cancellationToken: _ct);
        var projectOn = await on.CallToolAsync("get_project", new Dictionary<string, object?> { ["projectKey"] = "TKT" }, cancellationToken: _ct);
        var projectOff = await off.CallToolAsync("get_project", new Dictionary<string, object?> { ["projectKey"] = "TKT" }, cancellationToken: _ct);

        // Assert
        Assert.Contains(Tool, onTools);
        Assert.DoesNotContain(Tool, offTools);
        Assert.Contains("get_project", offTools);
        Assert.True(called.IsError);
        Assert.Equal(AgentErrors.Disabled, Payload(called).GetProperty("code").GetString());
        Assert.Equal(JsonValueKind.Object, Payload(projectOn).GetProperty("agent").ValueKind);
        Assert.False(Payload(projectOff).TryGetProperty("agent", out var hidden) && hidden.ValueKind != JsonValueKind.Null);
    }

    [Fact]
    public async Task Without_a_public_url_agent_delegation_is_disabled_everywhere()
    {
        // Arrange
        var owner = await api.CreateUserAsync();
        var ticket = await api.TicketAsync(await api.ProjectAsync(owner, "TKT"), owner);
        await api.EnableAgentFlagAsync(owner);
        var client = await api.LoginAsync(owner);
        await using var mcp = await api.CreateMcpClientAsync(await api.CreatePatAsync(owner));
        var options = api.Services.GetRequiredService<IOptions<AgentOptions>>().Value;
        var publicUrl = options.PublicUrl;
        options.PublicUrl = " ";
        try
        {
            // Act
            var prompt = await client.GetAsync(Path(ticket), _ct);
            var setup = await client.GetAsync("/api/v1/projects/TKT/agent", _ct);
            var change = await client.PatchAsync("/api/v1/projects/TKT/agent", JsonContent.Create(new { enabled = false }), _ct);
            var templates = await client.GetAsync("/api/v1/projects/TKT/agent/prompts", _ct);
            var placeholders = await client.GetAsync("/api/v1/agent/prompt-placeholders", _ct);
            var project = await (await client.GetAsync("/api/v1/projects/TKT", _ct)).ReadAsync<JsonElement>();
            var tools = await ToolNamesAsync(mcp);
            var called = await mcp.CallToolAsync(Tool, new Dictionary<string, object?> { ["key"] = ticket }, cancellationToken: _ct);

            // Assert
            var problem = await prompt.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
            Assert.Contains(AgentOptions.PublicUrlVariable, problem.GetProperty("title").GetString(), StringComparison.Ordinal);
            await setup.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
            await change.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
            await templates.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
            await placeholders.ShouldBeProblemAsync(HttpStatusCode.NotFound, AgentErrors.Disabled);
            Assert.Equal(JsonValueKind.Null, project.GetProperty("agent").ValueKind);
            Assert.DoesNotContain(Tool, tools);
            Assert.Equal(AgentErrors.Disabled, Payload(called).GetProperty("code").GetString());
        }
        finally
        {
            options.PublicUrl = publicUrl;
        }
    }

    [Theory]
    [InlineData(null, true)]
    [InlineData("", true)]
    [InlineData("http://localhost:8090", true)]
    [InlineData("https://tickets.example.com/", true)]
    [InlineData("https://example.com/ticketing", true)]
    [InlineData("localhost:8090", false)]
    [InlineData("ftp://tickets.example.com", false)]
    [InlineData("https://tickets.example.com/?x=1", false)]
    [InlineData("/relative", false)]
    public void The_public_url_must_be_an_absolute_http_url_when_set(string? value, bool valid) =>
        Assert.Equal(valid, new AgentOptions { PublicUrl = value }.IsValid);

    private static string Path(string ticketKey) => $"/api/v1/tickets/{ticketKey}/agent-prompt";

    private async Task<IReadOnlyList<string>> ToolNamesAsync(McpClient client) =>
        [.. (await client.ListToolsAsync(cancellationToken: _ct)).Select(t => t.Name)];

    private static JsonElement Payload(CallToolResult result) =>
        JsonDocument.Parse(Assert.IsType<TextContentBlock>(Assert.Single(result.Content)).Text).RootElement;
}
