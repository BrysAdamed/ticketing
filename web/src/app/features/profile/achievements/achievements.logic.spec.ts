import { MyAchievement } from '@core/achievements/achievement.models';
import {
  closeness,
  gridMove,
  groupAchievements,
  tileOf,
  tileProgress,
  unseenIds,
} from './achievements.logic';

const FOUR = [1, 10, 50, 250];

function achievement(
  id: string,
  tier: number,
  count: number,
  thresholds: number[] = FOUR,
  overrides: Partial<MyAchievement> = {},
): MyAchievement {
  const next = thresholds[tier];
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${id} things.`,
    howToEarn: `Do ${id} things.`,
    icon: 'file-plus',
    secret: false,
    masked: false,
    tier,
    shared: false,
    tiers: thresholds.map((threshold, i) => ({
      tier: i + 1,
      threshold,
      unlockedAt: i < tier ? '2026-10-29T10:00:00Z' : null,
      seenAt: i < tier ? '2026-10-29T10:05:00Z' : null,
    })),
    progress: {
      count,
      nextTier: next === undefined ? null : tier + 1,
      nextThreshold: next ?? null,
    },
    ...overrides,
  };
}

const MASKED: MyAchievement = {
  id: null,
  name: null,
  description: null,
  howToEarn: null,
  icon: null,
  secret: true,
  masked: true,
  tier: 0,
  shared: false,
  tiers: [],
  progress: null,
};

describe('tileProgress', () => {
  it('shows the count towards the next tier of an earned achievement', () => {
    // Arrange
    const reporter = achievement('reporter', 2, 23);

    // Act
    const progress = tileProgress(reporter);

    // Assert
    expect(progress).toEqual({ text: '23 of 50 to Gold', fraction: 0.46, nextTier: 3 });
  });

  it('says "Highest tier" without a bar at the top tier', () => {
    // Act
    const progress = tileProgress(achievement('closer', 4, 300));

    // Assert
    expect(progress).toEqual({ text: 'Highest tier', fraction: null, nextTier: null });
  });

  it('caps the bar when the count passed the threshold before the projector awarded it', () => {
    // Act
    const progress = tileProgress(achievement('closer', 1, 12));

    // Assert
    expect(progress?.fraction).toBe(1);
    expect(progress?.text).toBe('12 of 10 to Silver');
  });

  it('shows progress towards Bronze once something counted', () => {
    // Act
    const progress = tileProgress(achievement('triage', 0, 4, [10, 50, 200]));

    // Assert
    expect(progress).toEqual({ text: '4 of 10 to Bronze', fraction: 0.4, nextTier: 1 });
  });

  it('shows nothing for a zero count, a one-time achievement or a masked secret', () => {
    // Act / Assert
    expect(tileProgress(achievement('connector', 0, 0))).toBeNull();
    expect(tileProgress(achievement('board-builder', 1, 1, [1]))).toBeNull();
    expect(tileProgress(achievement('board-builder', 0, 0, [1]))).toBeNull();
    expect(tileProgress(MASKED)).toBeNull();
  });
});

describe('tileOf', () => {
  it('writes the tier and the accessible name with name and tier', () => {
    // Act
    const gold = tileOf(achievement('closer', 3, 61), 1);
    const once = tileOf(achievement('board-builder', 1, 1, [1]), 2);
    const locked = tileOf(achievement('triage', 0, 4, [10, 50, 200]), 3);
    const secret = tileOf(
      achievement('second-thoughts', 1, 1, [1], { secret: true, name: 'Second thoughts' }),
      4,
    );
    const masked = tileOf(MASKED, 5);

    // Assert
    expect([gold.tierText, gold.label]).toEqual(['Gold', 'Closer, Gold']);
    expect([once.tierText, once.label]).toEqual(['Earned', 'Board-builder, earned']);
    expect([locked.tierText, locked.label]).toEqual([
      'Not earned yet',
      'Triage, not earned yet, 4 of 10 to Bronze',
    ]);
    expect(secret.label).toBe('Second thoughts, secret, earned');
    expect([masked.key, masked.tierText, masked.label]).toEqual([
      'secret-5',
      'Secret',
      'Secret achievement, not earned yet',
    ]);
  });
});

describe('groupAchievements', () => {
  it('orders Earned by highest tier, one-time achievements after the tiered ones', () => {
    // Arrange
    const items = [
      achievement('reporter', 2, 23),
      achievement('board-builder', 1, 1, [1]),
      achievement('closer', 3, 61),
      achievement('talker', 1, 9),
      achievement('review', 4, 300),
    ];

    // Act
    const { earned } = groupAchievements(items);

    // Assert
    expect(earned.map((t) => t.key)).toEqual([
      'review',
      'closer',
      'reporter',
      'talker',
      'board-builder',
    ]);
  });

  it('orders Still to earn closest first and keeps catalogue order on ties', () => {
    // Arrange
    const items = [
      achievement('connector', 0, 0),
      achievement('runner', 0, 3, [10, 100, 500]),
      achievement('test-author', 0, 0),
      achievement('triage', 0, 4, [10, 50, 200]),
    ];

    // Act
    const { toEarn } = groupAchievements(items);

    // Assert
    expect(toEarn.map((t) => t.key)).toEqual(['triage', 'runner', 'connector', 'test-author']);
  });

  it('puts masked secrets in Secret and earned secrets in Earned', () => {
    // Arrange
    const earnedSecret = achievement('second-thoughts', 1, 1, [1], { secret: true });

    // Act
    const groups = groupAchievements([MASKED, earnedSecret, MASKED]);

    // Assert
    expect(groups.earned.map((t) => t.key)).toEqual(['second-thoughts']);
    expect(groups.toEarn).toEqual([]);
    expect(groups.secret.map((t) => t.key)).toEqual(['secret-0', 'secret-2']);
  });
});

describe('closeness', () => {
  it('is the share of the next threshold, 0 without progress', () => {
    // Act / Assert
    expect(closeness(achievement('triage', 0, 5, [10, 50, 200]))).toBe(0.5);
    expect(closeness(MASKED)).toBe(0);
  });
});

describe('unseenIds', () => {
  it('lists achievements with an earned tier not seen yet', () => {
    // Arrange
    const unseen = achievement('closer', 2, 12);
    unseen.tiers[1] = { ...unseen.tiers[1], seenAt: null };

    // Act
    const ids = unseenIds([achievement('reporter', 2, 23), unseen, MASKED]);

    // Assert
    expect(ids).toEqual(['closer']);
  });
});

describe('gridMove', () => {
  const groups = [4, 5, 2];

  it('moves left and right through every tile without wrapping at the ends', () => {
    // Act / Assert
    expect(gridMove('ArrowRight', 3, groups, 3)).toBe(4);
    expect(gridMove('ArrowRight', 10, groups, 3)).toBe(10);
    expect(gridMove('ArrowLeft', 0, groups, 3)).toBe(0);
  });

  it('moves down within a group and into the next group at the same column', () => {
    // Act / Assert
    expect(gridMove('ArrowDown', 1, groups, 3)).toBe(3);
    expect(gridMove('ArrowDown', 3, groups, 3)).toBe(4);
    expect(gridMove('ArrowDown', 6, groups, 3)).toBe(8);
    expect(gridMove('ArrowDown', 8, groups, 3)).toBe(10);
  });

  it('moves up into the last row of the previous group', () => {
    // Act / Assert
    expect(gridMove('ArrowUp', 5, groups, 3)).toBe(3);
    expect(gridMove('ArrowUp', 7, groups, 3)).toBe(4);
    expect(gridMove('ArrowUp', 2, groups, 3)).toBe(2);
  });

  it('jumps with Home and End and ignores other keys', () => {
    // Act / Assert
    expect(gridMove('Home', 7, groups, 3)).toBe(0);
    expect(gridMove('End', 1, groups, 3)).toBe(10);
    expect(gridMove('Enter', 1, groups, 3)).toBeNull();
    expect(gridMove('ArrowDown', 0, [], 3)).toBeNull();
  });
});
