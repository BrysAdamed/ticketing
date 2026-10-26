using System.Linq.Expressions;
using Microsoft.EntityFrameworkCore;
using Ticketing.Application.Abstractions;
using Ticketing.Application.Common;
using Ticketing.Domain.Projects;

namespace Ticketing.Application.Access;

internal sealed class ProjectAccess(ITicketingDbContext db, ICurrentUser currentUser) : IProjectAccess
{
    public Task<ProjectAccessGrant?> FindAsync(Guid projectId, CancellationToken cancellationToken) =>
        FindAsync(p => p.Id == projectId, cancellationToken);

    public Task<ProjectAccessGrant?> FindAsync(string projectKeyOrId, CancellationToken cancellationToken)
    {
        if (Guid.TryParse(projectKeyOrId, out var id))
            return FindAsync(id, cancellationToken);
        var key = projectKeyOrId.Trim().ToUpperInvariant();
        return FindAsync(p => p.Key == key, cancellationToken);
    }

    public async Task<ProjectAccessGrant> EnsureCanReadAsync(Guid projectId, CancellationToken cancellationToken) =>
        await FindAsync(projectId, cancellationToken) ?? throw NotFound(projectId.ToString());

    public async Task<ProjectAccessGrant> EnsureCanReadAsync(string projectKeyOrId, CancellationToken cancellationToken) =>
        await FindAsync(projectKeyOrId, cancellationToken) ?? throw NotFound(projectKeyOrId);

    public async Task<ProjectAccessGrant> EnsureCanWriteAsync(Guid projectId, CancellationToken cancellationToken) =>
        EnsureWrite(await EnsureCanReadAsync(projectId, cancellationToken));

    public async Task<ProjectAccessGrant> EnsureCanWriteAsync(string projectKeyOrId, CancellationToken cancellationToken) =>
        EnsureWrite(await EnsureCanReadAsync(projectKeyOrId, cancellationToken));

    public async Task<ProjectAccessGrant> EnsureOwnerAsync(Guid projectId, CancellationToken cancellationToken, bool allowArchived = false) =>
        EnsureOwner(await EnsureCanReadAsync(projectId, cancellationToken), allowArchived);

    public async Task<ProjectAccessGrant> EnsureOwnerAsync(string projectKeyOrId, CancellationToken cancellationToken, bool allowArchived = false) =>
        EnsureOwner(await EnsureCanReadAsync(projectKeyOrId, cancellationToken), allowArchived);

    public IQueryable<Project> ReadableProjects()
    {
        var projects = db.Projects.Where(p => p.DeletedAt == null);
        if (!currentUser.IsAuthenticated)
            return projects.Where(_ => false);
        if (currentUser.IsAdmin)
            return projects;
        var userId = currentUser.Id;
        return projects.Where(p => p.Visibility == ProjectVisibility.Public || p.Members.Any(m => m.UserId == userId));
    }

    private async Task<ProjectAccessGrant?> FindAsync(Expression<Func<Project, bool>> predicate, CancellationToken cancellationToken)
    {
        if (!currentUser.IsAuthenticated)
            return null;
        var userId = currentUser.Id;
        var row = await db.Projects
            .AsNoTracking()
            .Where(p => p.DeletedAt == null)
            .Where(predicate)
            .Select(p => new
            {
                p.Id,
                p.Key,
                p.Visibility,
                p.ArchivedAt,
                Membership = p.Members.Where(m => m.UserId == userId).Select(m => (ProjectRole?)m.Role).FirstOrDefault(),
            })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null)
            return null;

        var role = ProjectAccessPolicy.Effective(userIsActive: true, currentUser.Role, row.Visibility, row.Membership);
        return role is null ? null : new ProjectAccessGrant(row.Id, row.Key, role.Value, row.Visibility, row.ArchivedAt is not null);
    }

    private ProjectAccessGrant EnsureWrite(ProjectAccessGrant grant)
    {
        if (!grant.CanWrite)
            throw AppException.Forbidden(ProjectErrors.Forbidden, $"You have read-only access to project {grant.ProjectKey}.");
        return EnsureWritable(grant);
    }

    private ProjectAccessGrant EnsureOwner(ProjectAccessGrant grant, bool allowArchived)
    {
        if (!grant.IsOwner)
            throw AppException.Forbidden(ProjectErrors.Forbidden, $"Only owners of project {grant.ProjectKey} can do this.");
        return allowArchived ? EnsureWriteScope(grant) : EnsureWritable(grant);
    }

    private ProjectAccessGrant EnsureWritable(ProjectAccessGrant grant)
    {
        EnsureWriteScope(grant);
        if (grant.IsArchived)
            throw AppException.Conflict(ProjectErrors.Archived, $"Project {grant.ProjectKey} is archived and read-only.", "Unarchive the project first.");
        return grant;
    }

    private ProjectAccessGrant EnsureWriteScope(ProjectAccessGrant grant)
    {
        currentUser.EnsureWriteScope();
        return grant;
    }

    private static AppException NotFound(string reference) =>
        AppException.NotFound(ProjectErrors.NotFound, $"Project '{reference}' was not found.");
}
