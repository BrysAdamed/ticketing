using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Agents;
using Ticketing.Domain.Agents;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>Reference read use case: access check first, then one AsNoTracking projection into the DTO.</summary>
public static class GetProject
{
    /// <param name="ProjectKeyOrId">A project key (<c>WEB</c>, case-insensitive) or id.</param>
    public sealed record Query(string ProjectKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, AgentGate agents) : IHandler<Query, ProjectDto>
    {
        public async Task<ProjectDto> HandleAsync(Query request, CancellationToken cancellationToken) =>
            await LoadAsync(db, agents, await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken), cancellationToken);

        internal static async Task<ProjectDto> LoadAsync(ITicketingDbContext db, AgentGate agents, ProjectAccessGrant grant, CancellationToken cancellationToken)
        {
            var project = await db.Projects
                .AsNoTracking()
                .Where(p => p.Id == grant.ProjectId)
                .Select(p => new
                {
                    p.Id,
                    p.Key,
                    p.Name,
                    p.Description,
                    p.Visibility,
                    p.ArchivedAt,
                    p.CreatedAt,
                    p.RowVersion,
                    Agent = new AgentDelegationSettings(
                        p.AgentDelegationEnabled, p.RepositoryUrl, p.DefaultBranch, p.AgentMergePolicy, p.AgentAssignOnDelegate, p.AgentStartProgressOnDelegate),
                })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(ProjectErrors.NotFound, $"Project '{grant.ProjectKey}' was not found.");
            var agent = await agents.IsEnabledAsync(cancellationToken) ? ProjectAgentSettingsDto.From(project.Agent, project.RowVersion) : null;

            var members = await ProjectMembership.LoadMembersAsync(db, grant.ProjectId, project.Visibility, cancellationToken);

            var boards = await db.BoardProjects
                .AsNoTracking()
                .Where(bp => bp.ProjectId == grant.ProjectId)
                .Join(db.Boards.Where(b => b.DeletedAt == null), bp => bp.BoardId, b => b.Id, (bp, b) => b)
                .OrderBy(b => b.Name)
                .Select(b => new LinkedBoardDto(b.Id, b.Name))
                .ToListAsync(cancellationToken);

            return new ProjectDto(
                project.Id, project.Key, project.Name, project.Description, project.Visibility, grant.Role,
                project.ArchivedAt, project.CreatedAt, members, boards, agent, project.RowVersion);
        }
    }
}
