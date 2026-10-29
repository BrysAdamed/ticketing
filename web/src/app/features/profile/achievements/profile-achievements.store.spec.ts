import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '@core/api/api-error';
import { MyAchievement, MyAchievements } from '@core/achievements/achievement.models';
import { AchievementUnlocks } from '@core/achievements/achievement-unlocks';
import { AchievementsAccess } from '@core/achievements/achievements-access';
import { AchievementsApi } from '@core/achievements/achievements.api';
import { AuthService } from '@core/auth/auth.service';
import { FeatureFlagService } from '@core/flags/feature-flag.service';
import { ToastOptions, ToastService } from '@core/notify/toast.service';
import { ProfileAchievementsStore } from './profile-achievements.store';

function closer(seenAt: string | null): MyAchievement {
  return {
    id: 'closer',
    name: 'Closer',
    description: 'Tickets you moved to Done.',
    howToEarn: 'Move a ticket to Done.',
    icon: 'circle-check',
    secret: false,
    masked: false,
    tier: 1,
    shared: false,
    tiers: [
      { tier: 1, threshold: 1, unlockedAt: '2026-10-29T10:00:00Z', seenAt },
      { tier: 2, threshold: 10, unlockedAt: null, seenAt: null },
    ],
    progress: { count: 3, nextTier: 2, nextThreshold: 10 },
  };
}

const REPORTER: MyAchievement = {
  ...closer(null),
  id: 'reporter',
  name: 'Reporter',
  tier: 0,
  tiers: [
    { tier: 1, threshold: 1, unlockedAt: null, seenAt: null },
    { tier: 2, threshold: 10, unlockedAt: null, seenAt: null },
  ],
  progress: { count: 0, nextTier: 1, nextThreshold: 1 },
};

class FakeApi {
  response: MyAchievements = { startedAt: '2026-10-29T09:00:00Z', items: [] };
  failure: unknown = null;
  list = vi.fn(() => (this.failure ? throwError(() => this.failure) : of(this.response)));
  markSeen = vi.fn(() => of({ count: 0, items: [] }));
  shareResult = new Subject<MyAchievement>();
  share = vi.fn(() => this.shareResult);
  unshare = vi.fn(() => this.shareResult);
}

class FakeToast {
  success = vi.fn((_message: string, _options?: ToastOptions) => undefined);
  error = vi.fn((_message: unknown, _options?: ToastOptions) => undefined);
}

describe('ProfileAchievementsStore', () => {
  let api: FakeApi;
  let flags: Record<string, string>;
  let unlocks: { apply: ReturnType<typeof vi.fn> };
  let toast: FakeToast;

  function setup(): ProfileAchievementsStore {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ProfileAchievementsStore,
        { provide: AchievementsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: FeatureFlagService, useValue: { isOn: (key: string) => flags[key] === 'on' } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: AchievementUnlocks, useValue: unlocks },
      ],
    });
    return TestBed.inject(ProfileAchievementsStore);
  }

  beforeEach(() => {
    api = new FakeApi();
    toast = new FakeToast();
    flags = { achievements: 'on' };
    unlocks = { apply: vi.fn() };
  });

  it('loads the catalogue into groups and marks the unseen earned ones seen', async () => {
    // Arrange
    api.response.items = [REPORTER, closer(null)];
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(store.status()).toBe('loaded');
    expect(store.groups().earned.map((t) => t.key)).toEqual(['closer']);
    expect(store.groups().toEarn.map((t) => t.key)).toEqual(['reporter']);
    expect(store.nothingEarned()).toBe(false);
    expect(api.markSeen).toHaveBeenCalledWith(['closer']);
    expect(unlocks.apply).toHaveBeenCalledWith({ count: 0, items: [] });
    expect(store.items()[1].tiers[0].seenAt).not.toBeNull();
  });

  it('marks nothing seen when every earned tier was seen', async () => {
    // Arrange
    api.response.items = [closer('2026-10-29T10:05:00Z')];
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(api.markSeen).not.toHaveBeenCalled();
  });

  it('reports nothing earned yet for the empty state', async () => {
    // Arrange
    api.response.items = [REPORTER];
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(store.nothingEarned()).toBe(true);
  });

  it('hides achievements for the session on 404 achievements.disabled', async () => {
    // Arrange
    api.failure = new ApiError(404, 'achievements.disabled', 'Achievements are off.');
    const store = setup();
    const access = TestBed.inject(AchievementsAccess);
    expect(access.enabled()).toBe(true);

    // Act
    await store.load();

    // Assert
    expect(store.status()).toBe('disabled');
    expect(access.enabled()).toBe(false);
    expect(api.markSeen).not.toHaveBeenCalled();
  });

  it('shows an error for other failures and keeps the tab', async () => {
    // Arrange
    api.failure = new ApiError(500, 'server.error', 'Boom');
    const store = setup();

    // Act
    await store.load();

    // Assert
    expect(store.status()).toBe('error');
    expect(TestBed.inject(AchievementsAccess).enabled()).toBe(true);
  });

  describe('sharing', () => {
    async function loaded(): Promise<ProfileAchievementsStore> {
      api.response.items = [REPORTER, closer('2026-10-29T10:05:00Z')];
      const store = setup();
      await store.load();
      return store;
    }

    const closerItem = (store: ProfileAchievementsStore) =>
      store.items().find((i) => i.id === 'closer')!;

    it('marks the medal shared at once and keeps the server item, with Undo', async () => {
      // Arrange
      const store = await loaded();

      // Act
      const done = store.setShared('closer', true);
      const optimistic = closerItem(store).shared;
      const pending = store.sharing().has('closer');
      api.shareResult.next({ ...closer('2026-10-29T10:05:00Z'), shared: true });
      api.shareResult.complete();
      await done;

      // Assert
      expect(optimistic).toBe(true);
      expect(pending).toBe(true);
      expect(api.share).toHaveBeenCalledWith('closer');
      expect(closerItem(store).shared).toBe(true);
      expect(store.sharing().size).toBe(0);
      expect(store.groups().earned[0].label).toBe('Closer, Bronze, shared');
      const [message, options] = toast.success.mock.calls[0];
      expect(message).toBe('Closer is shared');
      expect(options?.action?.label).toBe('Undo');
    });

    it('Undo stops sharing again', async () => {
      // Arrange
      const store = await loaded();
      const done = store.setShared('closer', true);
      api.shareResult.next({ ...closer('2026-10-29T10:05:00Z'), shared: true });
      api.shareResult.complete();
      await done;
      api.shareResult = new Subject<MyAchievement>();

      // Act
      toast.success.mock.calls[0][1]?.action?.run();

      // Assert
      expect(api.unshare).toHaveBeenCalledWith('closer');
      expect(closerItem(store).shared).toBe(false);
    });

    it('rolls back with a danger toast when the server refuses', async () => {
      // Arrange
      const store = await loaded();

      // Act
      const done = store.setShared('closer', true);
      api.shareResult.error(new ApiError(500, 'server.error', 'Boom'));
      await done;

      // Assert
      expect(closerItem(store).shared).toBe(false);
      expect(toast.error).toHaveBeenCalledWith("Couldn't share Closer", expect.anything());
      expect(toast.success).not.toHaveBeenCalled();
      expect(store.sharing().size).toBe(0);
    });

    it('ignores unearned achievements and a second toggle while one is on its way', async () => {
      // Arrange
      const store = await loaded();

      // Act
      await store.setShared('reporter', true);
      const first = store.setShared('closer', true);
      await store.setShared('closer', false);
      api.shareResult.next({ ...closer('2026-10-29T10:05:00Z'), shared: true });
      api.shareResult.complete();
      await first;

      // Assert
      expect(api.share).toHaveBeenCalledTimes(1);
      expect(api.unshare).not.toHaveBeenCalled();
      expect(store.items().find((i) => i.id === 'reporter')!.shared).toBe(false);
    });

    it('hides the tab when sharing finds achievements turned off', async () => {
      // Arrange
      const store = await loaded();

      // Act
      const done = store.setShared('closer', true);
      api.shareResult.error(new ApiError(404, 'achievements.disabled', 'Off.'));
      await done;

      // Assert
      expect(store.status()).toBe('disabled');
      expect(toast.error).not.toHaveBeenCalled();
    });
  });

  it('shows the tab only while the flag is on', () => {
    // Arrange
    flags = {};
    setup();

    // Act
    const enabled = TestBed.inject(AchievementsAccess).enabled();

    // Assert
    expect(enabled).toBe(false);
  });
});
