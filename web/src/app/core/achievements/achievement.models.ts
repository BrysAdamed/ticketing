export const ACHIEVEMENTS_DISABLED = 'achievements.disabled';

export interface AchievementTier {
  tier: number;
  threshold: number;
  unlockedAt: string | null;
  seenAt: string | null;
}

export interface AchievementProgress {
  count: number;
  nextTier: number | null;
  nextThreshold: number | null;
}

/// One catalogue entry of `GET /me/achievements` (spec 15.6). A masked secret has null id, name,
/// description, howToEarn, icon and progress, `tier: 0` and no tiers.
export interface MyAchievement {
  id: string | null;
  name: string | null;
  description: string | null;
  howToEarn: string | null;
  icon: string | null;
  secret: boolean;
  masked: boolean;
  tier: number;
  /// Whether the owner shares it with every signed-in user (spec 15.7); false while not earned.
  shared: boolean;
  tiers: AchievementTier[];
  progress: AchievementProgress | null;
}

/// One of another user's shared achievements (`GET /users/{id}/achievements`, spec 15.7): no
/// dates, counts or progress.
export interface SharedAchievement {
  id: string;
  name: string;
  icon: string;
  tier: number;
}

export interface SharedAchievements {
  items: SharedAchievement[];
}

export interface MyAchievements {
  startedAt: string;
  items: MyAchievement[];
}

export interface UnseenAchievement {
  id: string;
  name: string;
  tier: number;
  icon: string;
}

export interface UnseenAchievements {
  count: number;
  items: UnseenAchievement[];
}
