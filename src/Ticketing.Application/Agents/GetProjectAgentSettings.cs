using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;

namespace Ticketing.Application.Agents;

/// <summary>A project's agent setup; anyone who can read the project, PATs included, once the agent gate is open.</summary>
public static class GetProjectAgentSettings
{
    public sealed record Query(string ProjectKeyOrId);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents) : IHandler<Query, ProjectAgentSettingsDto>
    {
        public async Task<ProjectAgentSettingsDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = await agents.ReadProjectAsync(request.ProjectKeyOrId, cancellationToken);
            return await ProjectAgentSettingsDto.LoadAsync(db, grant.ProjectId, cancellationToken);
        }
    }
}
