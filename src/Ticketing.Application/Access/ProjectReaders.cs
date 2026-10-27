using Ticketing.Application.Abstractions;
using Ticketing.Domain.Projects;
using Ticketing.Domain.Users;

namespace Ticketing.Application.Access;

/// <summary>A user who can read a project.</summary>
public sealed class ProjectReader
{
    public required Guid ProjectId { get; init; }

    public required Guid UserId { get; init; }
}

/// <summary>
/// Who can read a project, as a query (mirrors <see cref="ProjectAccessPolicy"/>): active users that are Admins, any active
/// user for a public project, and members of any role, never for a deleted project. Used for watcher lists and the recipients
/// of anything derived from activity, so a user who lost access is hidden and gets nothing.
/// </summary>
public static class ProjectReaders
{
    public static IQueryable<User> Of(ITicketingDbContext db, Guid projectId)
    {
        var readers = Among(db, db.Projects.Where(p => p.Id == projectId), db.Users).Select(r => r.UserId);
        return db.Users.Where(u => readers.Contains(u.Id));
    }

    /// <summary>The pairs of <paramref name="projects"/> and <paramref name="users"/> where the user can read the project.</summary>
    public static IQueryable<ProjectReader> Among(ITicketingDbContext db, IQueryable<Project> projects, IQueryable<User> users) =>
        from p in projects
        where p.DeletedAt == null
        from u in users
        where u.IsActive
            && (u.GlobalRole == GlobalRole.Admin
                || p.Visibility == ProjectVisibility.Public
                || db.ProjectMembers.Any(m => m.ProjectId == p.Id && m.UserId == u.Id))
        select new ProjectReader { ProjectId = p.Id, UserId = u.Id };
}
