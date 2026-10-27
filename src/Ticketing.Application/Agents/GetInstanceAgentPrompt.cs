using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Agents;

/// <summary>An instance slot (a ticket type or <c>guardrails</c>) with its body and the latest built-in for comparison.</summary>
public static class GetInstanceAgentPrompt
{
    public sealed record Query(string Slot);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents, IBuiltInAgentPrompts builtIns) : IHandler<Query, InstanceAgentPromptDto>
    {
        public async Task<InstanceAgentPromptDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await agents.ReadAsync(null, request.Slot, cancellationToken);
            return await AgentPromptQueries.InstanceDtoAsync(db, builtIns, target.Slot, cancellationToken);
        }
    }
}
