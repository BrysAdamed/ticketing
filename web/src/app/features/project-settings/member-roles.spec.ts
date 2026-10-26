import { ProjectMember } from '@core/projects/project-context';
import {
  assignableRoles,
  effectiveMemberRole,
  memberRoleLabel,
  soleActiveOwnerId,
  sortMembers,
} from './member-roles';

function member(overrides: Partial<ProjectMember>): ProjectMember {
  return {
    userId: 'u1',
    email: 'a@example.com',
    displayName: 'Ann',
    role: 'Member',
    effectiveRole: 'Member',
    isActive: true,
    globalRole: 'User',
    addedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

describe('member roles', () => {
  it('hides Viewer on public projects only', () => {
    // Act / Assert
    expect(assignableRoles('Public')).toEqual(['Owner', 'Member']);
    expect(assignableRoles('Private')).toEqual(['Owner', 'Member', 'Viewer']);
  });

  it('labels a Viewer on a public project as a member', () => {
    // Act / Assert
    expect(memberRoleLabel('Viewer', 'Public')).toBe('Member (public project)');
    expect(memberRoleLabel('Viewer', 'Private')).toBe('Viewer');
    expect(memberRoleLabel('Owner', 'Public')).toBe('Owner');
  });

  it.each([
    [member({ role: 'Viewer' }), 'Public', 'Member'],
    [member({ role: 'Viewer' }), 'Private', 'Viewer'],
    [member({ role: 'Viewer', globalRole: 'Admin' }), 'Private', 'Owner'],
    [member({ role: 'Owner', isActive: false }), 'Private', null],
  ] as const)('computes effective access like spec 5.1 (%#)', (m, visibility, expected) => {
    // Act / Assert
    expect(effectiveMemberRole(m, visibility)).toBe(expected);
  });

  it('finds the only active owner, ignoring deactivated owners', () => {
    // Arrange
    const members = [
      member({ userId: 'owner', role: 'Owner' }),
      member({ userId: 'gone', role: 'Owner', isActive: false }),
      member({ userId: 'member' }),
    ];

    // Act / Assert
    expect(soleActiveOwnerId(members)).toBe('owner');
    expect(soleActiveOwnerId([...members, member({ userId: 'second', role: 'Owner' })])).toBeNull();
  });

  it('sorts by name, then email', () => {
    // Arrange
    const members = [
      member({ userId: '3', displayName: 'Zed' }),
      member({ userId: '2', displayName: 'Ann', email: 'b@example.com' }),
      member({ userId: '1', displayName: 'Ann', email: 'a@example.com' }),
    ];

    // Act / Assert
    expect(sortMembers(members).map((m) => m.userId)).toEqual(['1', '2', '3']);
  });
});
