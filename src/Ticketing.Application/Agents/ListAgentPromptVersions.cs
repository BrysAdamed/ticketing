using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Domain.Agents;

namespace Ticketing.Application.Agents;

/// <summary>
/// The history of a template slot, newest first (bodies via <see cref="GetAgentPromptVersion"/>). A project slot that never
/// left Inherit has no versions. <c>ProjectKeyOrId</c> null means an instance slot (Admins in the web app).
/// </summary>
public static class ListAgentPromptVersions
{
    public sealed record Query(string? ProjectKeyOrId, string Slot);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents) : IHandler<Query, IReadOnlyList<AgentPromptVersionSummaryDto>>
    {
        public async Task<IReadOnlyList<AgentPromptVersionSummaryDto>> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await agents.ReadAsync(request.ProjectKeyOrId, request.Slot, cancellationToken);
            var templateId = await AgentPromptQueries.For(db, target).Select(t => (Guid?)t.Id).SingleOrDefaultAsync(cancellationToken);
            if (templateId is null)
                return [];
            return await AgentPromptQueries.VersionSummaries(db, templateId.Value).ToListAsync(cancellationToken);
        }
    }
}
