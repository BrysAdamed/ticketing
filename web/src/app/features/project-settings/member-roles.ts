import { ProjectMember } from '@core/projects/project-context';
import { PROJECT_ROLES, ProjectRole, ProjectVisibility } from '@shared/domain/enums';

export const PUBLIC_VIEWER_LABEL = 'Member (public project)';

/// Roles offered in the role select. A Viewer has no effect on a public project (spec 5.1, D-16),
/// so the option is hidden there.
export function assignableRoles(visibility: ProjectVisibility): readonly ProjectRole[] {
  return visibility === 'Public' ? PROJECT_ROLES.filter((r) => r !== 'Viewer') : PROJECT_ROLES;
}

/// How a stored role reads in the members table.
export function memberRoleLabel(role: ProjectRole, visibility: ProjectVisibility): string {
  return role === 'Viewer' && visibility === 'Public' ? PUBLIC_VIEWER_LABEL : role;
}

/// Effective access of a membership (spec 5.1), for optimistic updates before the server answers.
export function effectiveMemberRole(
  member: Pick<ProjectMember, 'role' | 'isActive' | 'globalRole'>,
  visibility: ProjectVisibility,
): ProjectRole | null {
  if (!member.isActive) return null;
  if (member.globalRole === 'Admin') return 'Owner';
  if (visibility === 'Public') return member.role === 'Owner' ? 'Owner' : 'Member';
  return member.role;
}

/// The user id of the only active Owner member, whose demotion or removal the server refuses
/// (`project.lastOwner`), or null when there are several.
export function soleActiveOwnerId(members: readonly ProjectMember[]): string | null {
  const owners = members.filter((m) => m.role === 'Owner' && m.isActive);
  return owners.length === 1 ? owners[0].userId : null;
}

/// Members sorted like the server returns them: by display name, then email.
export function sortMembers(members: readonly ProjectMember[]): ProjectMember[] {
  return [...members].sort(
    (a, b) => a.displayName.localeCompare(b.displayName) || a.email.localeCompare(b.email),
  );
}
