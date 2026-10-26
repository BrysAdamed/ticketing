using Ticketing.Domain.Users;

namespace Ticketing.Domain.Projects;

/// <summary>Effective project access rules (spec 5.1). Null means no access.</summary>
public static class ProjectAccessPolicy
{
    public static ProjectRole? Effective(bool userIsActive, GlobalRole globalRole, ProjectVisibility visibility, ProjectRole? membership)
    {
        if (!userIsActive)
            return null;
        if (globalRole == GlobalRole.Admin)
            return ProjectRole.Owner;
        if (visibility == ProjectVisibility.Public)
            return membership == ProjectRole.Owner ? ProjectRole.Owner : ProjectRole.Member;
        return membership;
    }

    public static bool CanRead(ProjectRole? access) => access is not null;

    public static bool CanWrite(ProjectRole? access) => access is ProjectRole.Owner or ProjectRole.Member;

    public static bool IsOwner(ProjectRole? access) => access is ProjectRole.Owner;
}
