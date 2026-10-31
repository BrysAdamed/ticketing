import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { ApiError } from '@core/api/api-error';
import {
  NotificationPreferences,
  NotificationPreferencesApi,
  NotificationPreferencesChange,
} from '@core/notifications/notification-preferences.api';
import { NOTIFICATION_KINDS } from '@core/notifications/notification.models';
import { ToastService } from '@core/notify/toast.service';
import { ProjectDirectory } from '@core/projects/project-directory';
import { NotificationPreferencesStore } from './notification-preferences.store';

const DIRECT = new Set(['Assigned', 'Mentioned', 'RegressionItemAssigned']);

function preferences(muted: string[] = []): NotificationPreferences {
  return {
    kinds: NOTIFICATION_KINDS.map((kind) => ({
      kind,
      muted: muted.includes(kind),
      direct: DIRECT.has(kind),
    })),
    mutedProjects: [],
    updatedAt: null,
  };
}

class FakeApi {
  calls: { change: NotificationPreferencesChange; reply: Subject<NotificationPreferences> }[] = [];
  get = vi.fn(() => of(preferences()));
  change = vi.fn((change: NotificationPreferencesChange) => {
    const reply = new Subject<NotificationPreferences>();
    this.calls.push({ change, reply });
    return reply;
  });

  answer(index: number, value: NotificationPreferences): void {
    this.calls[index].reply.next(value);
    this.calls[index].reply.complete();
  }

  fail(index: number): void {
    this.calls[index].reply.error(new ApiError(500, 'server.error', 'Boom'));
  }
}

function mutedKinds(store: NotificationPreferencesStore): string[] {
  return (store.preferences()?.kinds ?? []).filter((k) => k.muted).map((k) => k.kind);
}

describe('NotificationPreferencesStore', () => {
  let api: FakeApi;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  async function setup(): Promise<NotificationPreferencesStore> {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        NotificationPreferencesStore,
        { provide: NotificationPreferencesApi, useValue: api },
        { provide: ToastService, useValue: toast },
        {
          provide: ProjectDirectory,
          useValue: { projects: signal([]), load: () => Promise.resolve() },
        },
      ],
    });
    const store = TestBed.inject(NotificationPreferencesStore);
    await store.load();
    return store;
  }

  beforeEach(() => {
    api = new FakeApi();
    toast = { success: vi.fn(), error: vi.fn() };
  });

  it('shows a toggle at once and takes the server state when it answers', async () => {
    // Arrange
    const store = await setup();

    // Act
    const saving = store.setKind('Moved', true);
    const optimistic = mutedKinds(store);
    api.answer(0, { ...preferences(['Moved']), updatedAt: '2026-10-31T10:00:00Z' });
    await saving;

    // Assert
    expect(optimistic).toEqual(['Moved']);
    expect(api.calls[0].change).toEqual({ muteKinds: ['Moved'] });
    expect(store.preferences()?.updatedAt).toBe('2026-10-31T10:00:00Z');
  });

  it('keeps a later edit while an earlier answer arrives', async () => {
    // Arrange
    const store = await setup();

    // Act
    const first = store.setKind('Moved', true);
    const second = store.setKind('Deleted', true);
    api.answer(0, preferences(['Moved']));
    await first;
    const between = mutedKinds(store);
    api.answer(1, preferences(['Moved', 'Deleted']));
    await second;

    // Assert
    expect(between).toEqual(['Moved', 'Deleted']);
    expect(mutedKinds(store)).toEqual(['Moved', 'Deleted']);
  });

  it('rolls back only the failed edit and offers a retry', async () => {
    // Arrange
    const store = await setup();

    // Act
    const first = store.setKind('Moved', true);
    const second = store.setKind('Deleted', true);
    api.fail(0);
    await first;
    api.answer(1, preferences(['Deleted']));
    await second;

    // Assert
    expect(mutedKinds(store)).toEqual(['Deleted']);
    expect(toast.error).toHaveBeenCalledWith(
      expect.any(ApiError),
      expect.objectContaining({ action: expect.objectContaining({ label: 'Retry' }) }),
    );
  });

  it('confirms a muted project with an undo', async () => {
    // Arrange
    const store = await setup();
    const web = { id: 'p-web', key: 'WEB', name: 'Web' };

    // Act
    const muting = store.muteProject(web);
    const optimistic = store.mutedProjects().map((p) => p.key);
    api.answer(0, { ...preferences(), mutedProjects: [web] });
    await muting;
    toast.success.mock.calls[0][1].action.run();

    // Assert
    expect(optimistic).toEqual(['WEB']);
    expect(api.calls[0].change).toEqual({ muteProjects: ['p-web'] });
    expect(api.calls[1].change).toEqual({ unmuteProjects: ['p-web'] });
    expect(store.mutedProjects()).toEqual([]);
  });
});
