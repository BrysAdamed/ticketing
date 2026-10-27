using Ticketing.Application.Abstractions;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>The instance defaults per ticket type and the guardrails (Admins in the web app), in slot order.</summary>
public static class ListInstanceAgentPrompts
{
    public sealed record Query;

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents, IBuiltInAgentPrompts builtIns)
        : IHandler<Query, IReadOnlyList<InstanceAgentPromptSummaryDto>>
    {
        public async Task<IReadOnlyList<InstanceAgentPromptSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            await agents.EnsureAdminAsync(cancellationToken);
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);
            var overriding = await AgentPromptQueries.OverridingCountsAsync(db, cancellationToken);
            var users = await AgentPromptQueries.UsersAsync(db, instance.Values.Select(t => t.UpdatedById), cancellationToken);
            return [.. AgentPromptSlot.Instance.Select(slot => AgentPromptQueries.InstanceSummary(instance[slot], builtIns, overriding, users))];
        }
    }
}
