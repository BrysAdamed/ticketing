import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ProjectContext, ProjectDetail, ProjectMember } from '@core/projects/project-context';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ProjectSettingsStore } from './project-settings.store';

function member(userId: string, overrides: Partial<ProjectMember> = {}): ProjectMember {
  return {
    userId,
    email: `${userId}@example.com`,
    displayName: userId,
    role: 'Member',
    effectiveRole: 'Member',
    isActive: true,
    globalRole: 'User',
    addedAt: '2026-10-01T00:00:00Z',
    ...overrides,
  };
}

function project(members: ProjectMember[], overrides: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: 'p1',
    key: 'WEB',
    name: 'Website',
    description: null,
    visibility: 'Private',
    myRole: 'Owner',
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    members,
    boards: [],
    rowVersion: 7,
    ...overrides,
  };
}

describe('ProjectSettingsStore', () => {
  let api: {
    patch: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    post: ReturnType<typeof vi.fn>;
  };
  let context: ProjectContext;
  let store: ProjectSettingsStore;

  beforeEach(() => {
    api = { patch: vi.fn(), delete: vi.fn(), post: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ProjectContext,
        ProjectSettingsStore,
        { provide: ApiClient, useValue: api },
        { provide: ProjectDirectory, useValue: { reload: vi.fn(), byKey: () => undefined } },
        {
          provide: AuthService,
          useValue: { isAdmin: signal(false), currentUser: signal({ id: 'me' }) },
        },
      ],
    });
    context = TestBed.inject(ProjectContext);
    context.projectKey.set('WEB');
    context.project.set(
      project([member('owner', { role: 'Owner', effectiveRole: 'Owner' }), member('ann')]),
    );
    store = TestBed.inject(ProjectSettingsStore);
  });

  it('changes a role optimistically and keeps the server result', async () => {
    // Arrange
    const ann = store.members()[1];
    api.patch.mockReturnValue(of({ ...ann, role: 'Viewer', effectiveRole: 'Viewer' }));

    // Act
    const pending = store.changeRole(ann, 'Viewer');
    const optimistic = store.members()[1].role;
    await pending;

    // Assert
    expect(optimistic).toBe('Viewer');
    expect(store.members()[1]).toMatchObject({ role: 'Viewer', effectiveRole: 'Viewer' });
    expect(api.patch).toHaveBeenCalledWith('/projects/WEB/members/ann', { role: 'Viewer' });
  });

  it('rolls a refused role change back', async () => {
    // Arrange
    const owner = store.members()[0];
    api.patch.mockReturnValue(
      throwError(
        () =>
          new ApiError(409, 'project.lastOwner', 'A project must keep at least one active owner.'),
      ),
    );

    // Act
    const result = store.changeRole(owner, 'Member');

    // Assert
    await expect(result).rejects.toMatchObject({ code: 'project.lastOwner' });
    expect(store.members()[0].role).toBe('Owner');
  });

  it('restores a member whose removal failed', async () => {
    // Arrange
    const ann = store.members()[1];
    api.delete.mockReturnValue(
      throwError(() => new ApiError(409, 'project.archived', 'Archived.')),
    );

    // Act
    const result = store.removeMember(ann);

    // Assert
    await expect(result).rejects.toBeInstanceOf(ApiError);
    expect(store.members().map((m) => m.userId)).toEqual(['owner', 'ann']);
  });

  it('sends only changed general fields with the row version', async () => {
    // Arrange
    api.patch.mockReturnValue(of(project([], { name: 'Web site', rowVersion: 8 })));

    // Act
    await store.saveGeneral({ name: 'Web site', description: '  ' });

    // Assert
    expect(api.patch).toHaveBeenCalledWith(
      '/projects/WEB',
      { name: 'Web site', description: null },
      { rowVersion: 7 },
    );
    expect(context.project()?.rowVersion).toBe(8);
  });

  it('owners cannot manage an archived project', () => {
    // Act
    context.project.set(project([], { archivedAt: '2026-10-02T00:00:00Z' }));

    // Assert
    expect(store.canManage()).toBe(false);
    expect(store.canArchive()).toBe(true);
  });
});
