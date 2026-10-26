using Ticketing.Domain.Projects;

namespace Ticketing.Application.Access;

/// <summary>
/// Effective project access for the current user (spec 5.1 and 5.3). Every project-scoped handler starts with one of the
/// Ensure methods; they throw <c>AppException</c>s that map to 404 (cannot read, never 403, so private projects stay
/// hidden), 403 (can read, may not act; read-only PAT) and 409 (archived project).
/// </summary>
public interface IProjectAccess
{
    /// <summary>The caller's effective role, or null when the project does not exist, is deleted or is not readable.</summary>
    Task<ProjectAccessGrant?> FindAsync(Guid projectId, CancellationToken cancellationToken);

    Task<ProjectAccessGrant?> FindAsync(string projectKey, CancellationToken cancellationToken);

    Task<ProjectAccessGrant> EnsureCanReadAsync(Guid projectId, CancellationToken cancellationToken);

    Task<ProjectAccessGrant> EnsureCanReadAsync(string projectKey, CancellationToken cancellationToken);

    /// <summary>Owner or Member, write-scoped credentials, project not archived.</summary>
    Task<ProjectAccessGrant> EnsureCanWriteAsync(Guid projectId, CancellationToken cancellationToken);

    Task<ProjectAccessGrant> EnsureCanWriteAsync(string projectKey, CancellationToken cancellationToken);

    /// <summary>Owner (Admins included), write-scoped credentials; archived projects only when <paramref name="allowArchived"/> (unarchive).</summary>
    Task<ProjectAccessGrant> EnsureOwnerAsync(Guid projectId, CancellationToken cancellationToken, bool allowArchived = false);

    Task<ProjectAccessGrant> EnsureOwnerAsync(string projectKey, CancellationToken cancellationToken, bool allowArchived = false);

    /// <summary>
    /// Non-deleted projects the caller can read. Compose it into any query that touches project data so private projects
    /// never leak through lists, search, boards or statistics, for example
    /// <c>db.Tickets.Where(t => access.ReadableProjects().Any(p => p.Id == t.ProjectId))</c>.
    /// </summary>
    IQueryable<Project> ReadableProjects();
}

public sealed record ProjectAccessGrant(Guid ProjectId, string ProjectKey, ProjectRole Role, ProjectVisibility Visibility, bool IsArchived)
{
    public bool CanWrite => ProjectAccessPolicy.CanWrite(Role);

    public bool IsOwner => ProjectAccessPolicy.IsOwner(Role);
}
