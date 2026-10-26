using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Access;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>Reference read use case: access check first, then one AsNoTracking projection into the DTO.</summary>
public static class GetProject
{
    /// <param name="ProjectKeyOrId">A project key (<c>WEB</c>, case-insensitive) or id.</param>
    public sealed record Query(string ProjectKeyOrId);

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access) : IHandler<Query, ProjectDto>
    {
        public async Task<ProjectDto> HandleAsync(Query request, CancellationToken cancellationToken)
        {
            var grant = Guid.TryParse(request.ProjectKeyOrId, out var id)
                ? await access.EnsureCanReadAsync(id, cancellationToken)
                : await access.EnsureCanReadAsync(request.ProjectKeyOrId, cancellationToken);
            return await LoadAsync(db, grant, cancellationToken);
        }

        internal static async Task<ProjectDto> LoadAsync(ITicketingDbContext db, ProjectAccessGrant grant, CancellationToken cancellationToken)
        {
            var project = await db.Projects
                .AsNoTracking()
                .Where(p => p.Id == grant.ProjectId)
                .Select(p => new { p.Id, p.Key, p.Name, p.Description, p.Visibility, p.ArchivedAt, p.CreatedAt, p.RowVersion })
                .SingleOrDefaultAsync(cancellationToken)
                ?? throw AppException.NotFound(ProjectErrors.NotFound, $"Project '{grant.ProjectKey}' was not found.");

            var members = await db.ProjectMembers
                .AsNoTracking()
                .Where(m => m.ProjectId == grant.ProjectId)
                .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { Member = m, User = u })
                .OrderBy(x => x.User.DisplayName)
                .Select(x => new ProjectMemberDto(x.User.Id, x.User.Email, x.User.DisplayName, x.Member.Role, x.User.IsActive, x.User.GlobalRole))
                .ToListAsync(cancellationToken);

            var boards = await db.BoardProjects
                .AsNoTracking()
                .Where(bp => bp.ProjectId == grant.ProjectId)
                .Join(db.Boards.Where(b => b.DeletedAt == null), bp => bp.BoardId, b => b.Id, (bp, b) => b)
                .OrderBy(b => b.Name)
                .Select(b => new LinkedBoardDto(b.Id, b.Name))
                .ToListAsync(cancellationToken);

            return new ProjectDto(
                project.Id, project.Key, project.Name, project.Description, project.Visibility, grant.Role,
                project.ArchivedAt, project.CreatedAt, members, boards, project.RowVersion);
        }
    }
}
