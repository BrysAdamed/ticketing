import { NotificationPreferences } from '@core/notifications/notification-preferences.api';
import { NOTIFICATION_KINDS } from '@core/notifications/notification.models';
import { ProjectSummary } from '@core/projects/project-directory';
import {
  applyEdit,
  groupKinds,
  invertEdit,
  KIND_COPY,
  projectsToMute,
  toChange,
} from './notification-preferences.logic';

const DIRECT = new Set(['Assigned', 'Mentioned', 'RegressionItemAssigned']);

function preferences(): NotificationPreferences {
  return {
    kinds: NOTIFICATION_KINDS.map((kind) => ({ kind, muted: false, direct: DIRECT.has(kind) })),
    mutedProjects: [{ id: 'p-ops', key: 'OPS', name: 'Platform Ops' }],
    updatedAt: null,
  };
}

function project(id: string, key: string, archivedAt: string | null = null): ProjectSummary {
  return { id, key, name: `${key} project`, visibility: 'Public', myRole: 'Member', archivedAt };
}

describe('notification preferences logic', () => {
  it('has copy for every kind', () => {
    // Assert
    for (const kind of NOTIFICATION_KINDS) expect(KIND_COPY[kind].label).toBeTruthy();
  });

  it('groups direct kinds first, in display order', () => {
    // Act
    const groups = groupKinds(preferences().kinds);

    // Assert
    expect(groups.direct.map((k) => k.kind)).toEqual([
      'Mentioned',
      'Assigned',
      'RegressionItemAssigned',
    ]);
    expect(groups.following.map((k) => k.kind)).toEqual([
      'Commented',
      'StatusChanged',
      'PriorityRaised',
      'Moved',
      'Deleted',
    ]);
  });

  it('applies and inverts a kind edit', () => {
    // Arrange
    const edit = { type: 'kind', kind: 'Moved', muted: true } as const;

    // Act
    const muted = applyEdit(preferences(), edit);
    const back = applyEdit(muted, invertEdit(edit));

    // Assert
    expect(muted.kinds.filter((k) => k.muted).map((k) => k.kind)).toEqual(['Moved']);
    expect(back.kinds.every((k) => !k.muted)).toBe(true);
    expect(toChange(edit)).toEqual({ muteKinds: ['Moved'] });
    expect(toChange(invertEdit(edit))).toEqual({ unmuteKinds: ['Moved'] });
  });

  it('keeps muted projects sorted by key and never duplicates one', () => {
    // Arrange
    const web = { id: 'p-web', key: 'WEB', name: 'Web' };
    const api = { id: 'p-api', key: 'API', name: 'Api' };

    // Act
    const once = applyEdit(
      applyEdit(preferences(), { type: 'project', project: web, muted: true }),
      {
        type: 'project',
        project: api,
        muted: true,
      },
    );
    const twice = applyEdit(once, { type: 'project', project: web, muted: true });
    const unmuted = applyEdit(twice, { type: 'project', project: web, muted: false });

    // Assert
    expect(twice.mutedProjects.map((p) => p.key)).toEqual(['API', 'OPS', 'WEB']);
    expect(unmuted.mutedProjects.map((p) => p.key)).toEqual(['API', 'OPS']);
    expect(toChange({ type: 'project', project: web, muted: false })).toEqual({
      unmuteProjects: ['p-web'],
    });
  });

  it('offers the projects that are not muted yet, archived ones last', () => {
    // Act
    const options = projectsToMute(
      [
        project('p-web', 'WEB'),
        project('p-old', 'ARC', '2026-01-01T00:00:00Z'),
        project('p-ops', 'OPS'),
        project('p-api', 'API'),
      ],
      preferences().mutedProjects,
    );

    // Assert
    expect(options.map((o) => o.value.key)).toEqual(['API', 'WEB', 'ARC']);
    expect(options[0].label).toBe('API · API project');
  });
});
