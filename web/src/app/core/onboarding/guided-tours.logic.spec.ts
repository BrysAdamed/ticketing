import { pickTourProject, storedTourState, tourAccess } from './guided-tours.logic';

describe('guided tours logic', () => {
  describe('tourAccess', () => {
    it('lets Owners and Members write, and only Owners own', () => {
      // Act
      const owner = tourAccess({ role: 'Owner', archived: false }, false);
      const member = tourAccess({ role: 'Member', archived: false }, false);
      const viewer = tourAccess({ role: 'Viewer', archived: false }, false);

      // Assert
      expect(owner).toEqual({ canWrite: true, isOwner: true, isAdmin: false });
      expect(member).toEqual({ canWrite: true, isOwner: false, isAdmin: false });
      expect(viewer).toEqual({ canWrite: false, isOwner: false, isAdmin: false });
    });

    it('treats an archived project as read-only', () => {
      // Act
      const access = tourAccess({ role: 'Owner', archived: true }, false);

      // Assert
      expect(access.canWrite).toBe(false);
      expect(access.isOwner).toBe(true);
    });

    it('allows only admin steps outside a project', () => {
      // Act
      const access = tourAccess(null, true);

      // Assert
      expect(access).toEqual({ canWrite: false, isOwner: false, isAdmin: true });
    });
  });

  describe('pickTourProject', () => {
    const projects = [
      { key: 'OLD', myRole: 'Member' as const, updatedAt: '2026-01-01T00:00:00Z' },
      { key: 'READ', myRole: 'Viewer' as const, updatedAt: '2026-10-01T00:00:00Z' },
      { key: 'NEW', myRole: 'Owner' as const, updatedAt: '2026-09-01T00:00:00Z' },
      {
        key: 'GONE',
        myRole: 'Owner' as const,
        updatedAt: '2026-10-20T00:00:00Z',
        archivedAt: '2026-10-21T00:00:00Z',
      },
    ];

    it('keeps the project in context', () => {
      // Act / Assert
      expect(pickTourProject(projects, 'READ')).toBe('READ');
    });

    it('prefers the most recently updated writable project that is not archived', () => {
      // Act / Assert
      expect(pickTourProject(projects, null)).toBe('NEW');
    });

    it('falls back to the most recently updated readable project, else none', () => {
      // Act / Assert
      expect(
        pickTourProject(
          projects.filter((p) => p.myRole === 'Viewer'),
          null,
        ),
      ).toBe('READ');
      expect(pickTourProject([], null)).toBeNull();
    });
  });

  describe('storedTourState', () => {
    it('stores Completed for Done and Dismissed for Esc or Skip, nothing otherwise', () => {
      // Act / Assert
      expect(storedTourState('completed')).toBe('Completed');
      expect(storedTourState('dismissed')).toBe('Dismissed');
      expect(storedTourState('aborted')).toBeNull();
      expect(storedTourState('interrupted')).toBeNull();
    });
  });
});
