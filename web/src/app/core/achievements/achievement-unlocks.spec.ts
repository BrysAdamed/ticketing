import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { ApiError } from '../api/api-error';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../flags/feature-flag.service';
import { NotificationCenter } from '../notifications/notification-center';
import { ToastService } from '../notify/toast.service';
import { AchievementToastData } from './achievement-toast.component';
import { AchievementUnlocks } from './achievement-unlocks';
import { MyAchievement, UnseenAchievement, UnseenAchievements } from './achievement.models';
import { AchievementsAccess } from './achievements-access';
import { AchievementsApi } from './achievements.api';

function unseen(id: string, tier = 1): UnseenAchievement {
  return { id, name: id, tier, icon: 'award' };
}

function entry(id: string, tierCount: number): MyAchievement {
  return {
    id,
    name: id,
    description: `About ${id}.`,
    howToEarn: null,
    icon: 'award',
    secret: false,
    masked: false,
    tier: 1,
    shared: false,
    tiers: Array.from({ length: tierCount }, (_, i) => ({
      tier: i + 1,
      threshold: i + 1,
      unlockedAt: null,
      seenAt: null,
    })),
    progress: null,
  };
}

const flush = async () => {
  await import('./achievement-unlock-announcer');
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve));
};

describe('AchievementUnlocks', () => {
  let polls: Subject<void>;
  let response: UnseenAchievements;
  let failure: unknown;
  let api: {
    unseen: ReturnType<typeof vi.fn>;
    list: ReturnType<typeof vi.fn>;
  };
  let shown: { data: AchievementToastData; dismissed: Subject<void> }[];
  let flags: Record<string, string>;

  function create(): AchievementUnlocks {
    const unlocks = TestBed.inject(AchievementUnlocks);
    TestBed.tick();
    return unlocks;
  }

  function configure(): void {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: NotificationCenter, useValue: { polls } },
        { provide: AchievementsApi, useValue: api },
        { provide: FeatureFlagService, useValue: { isOn: (key: string) => flags[key] === 'on' } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'user-1' }) } },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        {
          provide: ToastService,
          useValue: {
            showComponent: vi.fn((_: unknown, data: AchievementToastData) => {
              const dismissed = new Subject<void>();
              shown.push({ data, dismissed });
              return { afterDismissed: () => dismissed };
            }),
          },
        },
      ],
    });
  }

  function titles(): string[] {
    return shown.map((s) =>
      s.data.toast.kind === 'single'
        ? s.data.toast.item.id
        : `summary:${s.data.toast.items.length}`,
    );
  }

  beforeEach(() => {
    localStorage.clear();
    polls = new Subject<void>();
    response = { count: 0, items: [] };
    failure = null;
    api = {
      unseen: vi.fn(() => (failure ? throwError(() => failure) : of(response))),
      list: vi.fn(() =>
        of({ startedAt: '2026-10-29T09:00:00Z', items: [entry('reporter', 4), entry('board', 1)] }),
      ),
    };
    shown = [];
    flags = { achievements: 'on' };
    configure();
  });

  it('fetches on the poll, shows the dot and toasts a new tier once', async () => {
    // Arrange
    const unlocks = create();
    await flush();
    response = { count: 1, items: [unseen('reporter')] };

    // Act
    polls.next();
    await flush();
    polls.next();
    await flush();

    // Assert
    expect(unlocks.hasUnseen()).toBe(true);
    expect(titles()).toEqual(['reporter']);
    const toast = shown[0].data.toast;
    expect(toast.kind === 'single' && toast.item.description).toBe('About reporter.');
  });

  it('does not toast again after a reload, only tiers not toasted before', async () => {
    // Arrange
    response = { count: 1, items: [unseen('reporter')] };
    create();
    await flush();
    expect(titles()).toEqual(['reporter']);
    shown = [];
    response = { count: 2, items: [unseen('reporter'), unseen('board')] };

    // Act
    configure();
    create();
    await flush();

    // Assert
    expect(titles()).toEqual(['board']);
    const toast = shown[0].data.toast;
    expect(toast.kind === 'single' && toast.item.tierCount).toBe(1);
  });

  it('shows queued toasts one after another', async () => {
    // Arrange
    response = { count: 2, items: [unseen('reporter'), unseen('board')] };

    // Act
    create();
    await flush();

    // Assert
    expect(titles()).toEqual(['reporter']);
    shown[0].dismissed.next();
    await flush();
    expect(titles()).toEqual(['reporter', 'board']);
  });

  it('collapses more than three new tiers into one summary toast', async () => {
    // Arrange
    response = {
      count: 4,
      items: [unseen('reporter'), unseen('reporter', 2), unseen('board'), unseen('closer')],
    };

    // Act
    create();
    await flush();

    // Assert
    expect(titles()).toEqual(['summary:4']);
  });

  it('fetches nothing while the flag is off', async () => {
    // Arrange
    flags = {};
    const unlocks = create();

    // Act
    polls.next();
    await flush();

    // Assert
    expect(api.unseen).not.toHaveBeenCalled();
    expect(unlocks.hasUnseen()).toBe(false);
  });

  it('turns achievements off for the session on 404 achievements.disabled', async () => {
    // Arrange
    failure = new ApiError(404, 'achievements.disabled', 'Achievements are off.');

    // Act
    const unlocks = create();
    await flush();
    TestBed.tick();
    polls.next();
    await flush();

    // Assert
    expect(TestBed.inject(AchievementsAccess).enabled()).toBe(false);
    expect(api.unseen).toHaveBeenCalledTimes(1);
    expect(unlocks.hasUnseen()).toBe(false);
  });

  it('clears the dot when the tab reports nothing unseen', async () => {
    // Arrange
    response = { count: 1, items: [unseen('reporter')] };
    const unlocks = create();
    await flush();

    // Act
    unlocks.apply({ count: 0, items: [] });

    // Assert
    expect(unlocks.hasUnseen()).toBe(false);
    expect(localStorage.getItem('tk.achievements.toasted.user-1')).toBeNull();
  });
});
