using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>The five ticket types of a project with their mode, effective source and version (spec 13.7).</summary>
public static class ListProjectAgentPrompts
{
    public sealed record Query(string ProjectKeyOrId);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents) : IHandler<Query, IReadOnlyList<ProjectAgentPromptSummaryDto>>
    {
        public async Task<IReadOnlyList<ProjectAgentPromptSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var project = await agents.ReadProjectAsync(request.ProjectKeyOrId, cancellationToken);
            var instance = await AgentPromptQueries.InstanceAsync(db, cancellationToken);
            var rows = await db.AgentPromptTemplates
                .AsNoTracking()
                .Where(t => t.Scope == AgentPromptScope.Project && t.ProjectId == project.ProjectId)
                .ToListAsync(cancellationToken);
            var users = await AgentPromptQueries.UsersAsync(db, rows.Select(r => r.UpdatedById), cancellationToken);
            return [.. AgentPromptSlot.TicketTypes.Select(slot => AgentPromptQueries.ProjectSummary(
                slot.Type!.Value, rows.SingleOrDefault(r => r.TicketType == slot.Type), instance[slot], users))];
        }
    }
}
