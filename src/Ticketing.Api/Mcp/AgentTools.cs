using System.ComponentModel;
using ModelContextProtocol.Server;
using Ticketing.Application.Agents;

namespace Ticketing.Api.Mcp;

/// <summary>Agent delegation over MCP (spec 13.9): listed only while the agent gate is open for the token's user.</summary>
[McpServerToolType]
public sealed class AgentTools
{
    [FeatureGate(typeof(AgentGate))]
    [McpServerTool(Name = "get_agent_prompt", ReadOnly = true, Idempotent = true, Title = "Get agent prompt")]
    [Description("Gets the prompt Delegate to agent would start a coding agent with for a ticket: the project's template for the ticket type "
        + "(or the instance default) followed by the guardrails. Use it when you were asked to work on a ticket without that prompt, then follow it. "
        + "Returns { prompt, ticketKey, ticketType, template { source (Default or Custom), version, updatedAt, updatedBy }, guardrailsVersion }. "
        + "Fails with agent.project.disabled when the project has no agent setup and agent.type.off when the project does not delegate this ticket type, "
        + "agent.template.invalid when a stored template no longer parses (the hint says who can fix it).")]
    public static Task<ResolvedAgentPromptDto> GetAgentPrompt(
        ResolveAgentPrompt.Handler handler,
        [Description("Ticket key (for example WEB-42) or id.")] string key,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ResolveAgentPrompt.Query(key), cancellationToken);
}
