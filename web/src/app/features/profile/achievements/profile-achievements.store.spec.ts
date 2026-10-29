import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@core/api/api-error';
import { MyAchievement, MyAchievements } from '@core/achievements/achievement.models';
import { AchievementUnlocks } from '@core/achievements/achievement-unlocks';
import { AchievementsAccess } from '@core/achievements/achievements-access';
import { AchievementsApi } from '@core/achievements/achievements.api';
import { AuthService } from '@core/auth/auth.service';
import { FeatureFlagService } from '@core/flags/feature-flag.service';
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
}

describe('ProfileAchievementsStore', () => {
  let api: FakeApi;
  let flags: Record<string, string>;
  let unlocks: { apply: ReturnType<typeof vi.fn> };

  function setup(): ProfileAchievementsStore {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ProfileAchievementsStore,
        { provide: AchievementsApi, useValue: api },
        { provide: FeatureFlagService, useValue: { isOn: (key: string) => flags[key] === 'on' } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: AchievementUnlocks, useValue: unlocks },
      ],
    });
    return TestBed.inject(ProfileAchievementsStore);
  }

  beforeEach(() => {
    api = new FakeApi();
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
