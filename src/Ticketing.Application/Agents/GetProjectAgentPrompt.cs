using Ticketing.Application.Abstractions;

namespace Ticketing.Application.Agents;

/// <summary>A project's prompt for one ticket type, with the effective body, the instance default and the guardrails.</summary>
public static class GetProjectAgentPrompt
{
    public sealed record Query(string ProjectKeyOrId, string Type);

    public sealed class Handler(ITicketingDbContext db, AgentPromptAccess agents) : IHandler<Query, ProjectAgentPromptDto>
    {
        public async Task<ProjectAgentPromptDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var target = await agents.ReadAsync(request.ProjectKeyOrId, request.Type, cancellationToken);
            return await AgentPromptQueries.ProjectDtoAsync(db, target.Project!.ProjectId, target.Type, cancellationToken);
        }
    }
}
