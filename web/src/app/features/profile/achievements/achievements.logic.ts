import { MyAchievement } from '@core/achievements/achievement.models';
import {
  medalLabel,
  progressText,
  tierText,
} from '@shared/ui/achievement-medal/achievement-medal.logic';

export interface TileProgress {
  text: string;
  /// 0..1 for the bar; null at the top tier, which shows the text only.
  fraction: number | null;
  /// The tier the bar is filled towards, for its colour.
  nextTier: number | null;
}

export interface AchievementTile {
  /// The id, or `secret-<catalogue index>` for a masked secret.
  key: string;
  item: MyAchievement;
  catalogueIndex: number;
  tierCount: number;
  tierText: string;
  progress: TileProgress | null;
  label: string;
}

export interface AchievementGroups {
  earned: AchievementTile[];
  toEarn: AchievementTile[];
  secret: AchievementTile[];
}

/// The progress line of a tile: towards the next tier while there is one and something counted,
/// "Highest tier" at the top; nothing for masked and one-time achievements or a zero count.
export function tileProgress(item: MyAchievement): TileProgress | null {
  const tierCount = item.tiers.length;
  if (item.masked || !item.progress || tierCount <= 1) return null;
  const { count, nextTier, nextThreshold } = item.progress;
  if (nextTier === null || nextThreshold === null)
    return item.tier > 0 ? { text: 'Highest tier', fraction: null, nextTier: null } : null;
  if (item.tier === 0 && count === 0) return null;
  const text = progressText(count, nextTier, nextThreshold, tierCount);
  if (!text) return null;
  return { text, fraction: Math.min(1, count / nextThreshold), nextTier };
}

export function tileOf(item: MyAchievement, catalogueIndex: number): AchievementTile {
  const tierCount = item.tiers.length;
  const progress = tileProgress(item);
  return {
    key: item.id ?? `secret-${catalogueIndex}`,
    item,
    catalogueIndex,
    tierCount,
    tierText: item.masked ? 'Secret' : tierText({ tier: item.tier, tierCount }),
    progress,
    label: medalLabel({
      name: item.name,
      tier: item.tier,
      tierCount,
      secret: item.secret,
      masked: item.masked,
      progress: item.tier === 0 ? progress?.text : null,
    }),
  };
}

/// How close an unearned achievement is to its first tier, 0..1.
export function closeness(item: MyAchievement): number {
  const progress = item.progress;
  if (!progress || !progress.nextThreshold) return 0;
  return Math.min(1, progress.count / progress.nextThreshold);
}

function earnedRank(tile: AchievementTile): number {
  return tile.tierCount > 1 ? tile.item.tier : 0.5;
}

/// Earned (highest tier first, one-time ones after the tiered), Still to earn (closest first) and
/// Secret (masked entries), each in catalogue order on ties. Earned secrets join Earned.
export function groupAchievements(items: readonly MyAchievement[]): AchievementGroups {
  const tiles = items.map(tileOf);
  const byCatalogue = (a: AchievementTile, b: AchievementTile) =>
    a.catalogueIndex - b.catalogueIndex;
  return {
    earned: tiles
      .filter((t) => !t.item.masked && t.item.tier > 0)
      .sort((a, b) => earnedRank(b) - earnedRank(a) || byCatalogue(a, b)),
    toEarn: tiles
      .filter((t) => !t.item.masked && t.item.tier <= 0)
      .sort((a, b) => closeness(b.item) - closeness(a.item) || byCatalogue(a, b)),
    secret: tiles.filter((t) => t.item.masked),
  };
}

/// Ids of achievements with an earned tier not seen yet.
export function unseenIds(items: readonly MyAchievement[]): string[] {
  return items
    .filter((i) => i.id && i.tiers.some((t) => t.unlockedAt && !t.seenAt))
    .map((i) => i.id as string);
}

/// The tile a key moves the roving focus to, over groups laid out one after another in a grid of
/// `columns`: arrows in 2D (Up and Down cross into the neighbouring group at the same column),
/// Home/End to the first and last tile; null for other keys.
export function gridMove(
  key: string,
  index: number,
  groupSizes: readonly number[],
  columns: number,
): number | null {
  const total = groupSizes.reduce((sum, size) => sum + size, 0);
  if (total === 0) return null;
  switch (key) {
    case 'ArrowRight':
      return Math.min(index + 1, total - 1);
    case 'ArrowLeft':
      return Math.max(index - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return total - 1;
    case 'ArrowDown':
    case 'ArrowUp':
      return verticalMove(key === 'ArrowDown' ? 1 : -1, index, groupSizes, Math.max(columns, 1));
    default:
      return null;
  }
}

interface Row {
  start: number;
  length: number;
}

function verticalMove(
  step: 1 | -1,
  index: number,
  groupSizes: readonly number[],
  columns: number,
): number {
  const rows: Row[] = [];
  let start = 0;
  for (const size of groupSizes) {
    for (let offset = 0; offset < size; offset += columns)
      rows.push({ start: start + offset, length: Math.min(columns, size - offset) });
    start += size;
  }
  const current = rows.findIndex((r) => index >= r.start && index < r.start + r.length);
  const target = rows[current + step];
  if (current < 0 || !target) return index;
  return target.start + Math.min(index - rows[current].start, target.length - 1);
}
