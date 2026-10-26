using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Projects;

/// <summary>Loading and locking shared by the membership, archive and unarchive use cases.</summary>
internal static class ProjectMembership
{
    public static async Task<IReadOnlyList<ProjectMemberDto>> LoadMembersAsync(
        ITicketingDbContext db, Guid projectId, ProjectVisibility visibility, CancellationToken cancellationToken)
    {
        var rows = await db.ProjectMembers
            .AsNoTracking()
            .Where(m => m.ProjectId == projectId)
            .Join(db.Users, m => m.UserId, u => u.Id, (m, u) => new { Member = m, User = u })
            .OrderBy(x => x.User.DisplayName).ThenBy(x => x.User.Email)
            .Select(x => new { x.User.Id, x.User.Email, x.User.DisplayName, x.Member.Role, x.User.IsActive, x.User.GlobalRole, x.Member.AddedAt })
            .ToListAsync(cancellationToken);

        return [.. rows.Select(r => new ProjectMemberDto(
            r.Id, r.Email, r.DisplayName, r.Role,
            ProjectAccessPolicy.Effective(r.IsActive, r.GlobalRole, visibility, r.Role),
            r.IsActive, r.GlobalRole, r.AddedAt))];
    }

    /// <summary>
    /// Locks the project row until the surrounding transaction commits, then loads it with its members, so concurrent
    /// membership changes cannot both remove "the other" last owner. Must run inside <c>InTransactionAsync</c>.
    /// </summary>
    public static async Task<Project> LockAndLoadAsync(ITicketingDbContext db, Guid projectId, CancellationToken cancellationToken)
    {
        await db.Database.ExecuteSqlAsync($"SELECT 1 FROM projects WHERE id = {projectId} FOR UPDATE", cancellationToken);
        return await db.Projects.Include(p => p.Members).SingleAsync(p => p.Id == projectId, cancellationToken);
    }

    /// <summary>Members of <paramref name="project"/> whose user account is active.</summary>
    public static async Task<IReadOnlySet<Guid>> ActiveMemberIdsAsync(ITicketingDbContext db, Project project, CancellationToken cancellationToken)
    {
        var memberIds = project.Members.Select(m => m.UserId).ToList();
        var active = await db.Users
            .Where(u => u.IsActive && memberIds.Contains(u.Id))
            .Select(u => u.Id)
            .ToListAsync(cancellationToken);
        return active.ToHashSet();
    }

    public static void EnsureIsMember(Project project, Guid userId)
    {
        if (!project.IsMember(userId))
            throw AppException.NotFound(ProjectErrors.NotMember, $"The user is not a member of project {project.Key}.");
    }
}
