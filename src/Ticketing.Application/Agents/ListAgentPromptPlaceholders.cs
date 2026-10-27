using Ticketing.Application.Abstractions;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>The placeholders a prompt template may use, for the editor's completion list (spec 13.4).</summary>
public static class ListAgentPromptPlaceholders
{
    public sealed record Query;

    public sealed class Handler(AgentGate gate) : IHandler<Query, IReadOnlyList<AgentPromptPlaceholder>>
    {
        public async Task<IReadOnlyList<AgentPromptPlaceholder>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            await gate.EnsureEnabledAsync(cancellationToken);
            return AgentPromptPlaceholders.All;
        }
    }
}
