import { tierName } from '@shared/ui/achievement-medal/achievement-medal.logic';
import { UnseenAchievement } from './achievement.models';

/// More new tiers than this at once collapse into one summary toast.
export const MAX_SEPARATE_TOASTS = 3;
/// How many medals and names the summary toast shows.
export const SUMMARY_MEDALS = 3;

/// An unseen tier with what the toast writes about it: the achievement's tier count (1 for a
/// one-time achievement) and its description, both from the catalogue when it could be read.
export interface UnlockToastItem extends UnseenAchievement {
  tierCount: number;
  description: string | null;
}

export type UnlockToast =
  | { kind: 'single'; item: UnlockToastItem }
  | { kind: 'summary'; items: readonly UnlockToastItem[] };

/// The dedupe key of one earned tier, `closer:2`.
export function unlockKey(item: Pick<UnseenAchievement, 'id' | 'tier'>): string {
  return `${item.id}:${item.tier}`;
}

/// The unseen tiers that have not been toasted yet, in the API's order (oldest unlock first).
export function freshUnlocks(
  unseen: readonly UnseenAchievement[],
  toasted: ReadonlySet<string>,
): UnseenAchievement[] {
  const keys = new Set<string>();
  return unseen.filter((item) => {
    const key = unlockKey(item);
    if (toasted.has(key) || keys.has(key)) return false;
    keys.add(key);
    return true;
  });
}

/// The toasted keys to keep: the old ones plus the fresh ones, limited to tiers that are still
/// unseen, so the list never outgrows the catalogue and a tier earned again after an opt-out
/// toasts again.
export function rememberToasted(
  toasted: Iterable<string>,
  fresh: readonly UnseenAchievement[],
  unseen: readonly UnseenAchievement[],
): string[] {
  const stillUnseen = new Set(unseen.map(unlockKey));
  const kept = new Set([...toasted, ...fresh.map(unlockKey)]);
  return [...kept].filter((key) => stillUnseen.has(key));
}

/// One toast per tier, or a single summary toast when there are more than
/// `MAX_SEPARATE_TOASTS`.
export function planUnlockToasts(items: readonly UnlockToastItem[]): UnlockToast[] {
  if (items.length === 0) return [];
  if (items.length > MAX_SEPARATE_TOASTS) return [{ kind: 'summary', items }];
  return items.map((item) => ({ kind: 'single', item }));
}

/// "Closer · Silver"; a one-time achievement shows its name alone.
export function unlockTitle(item: UnlockToastItem): string {
  return item.tierCount <= 1 ? item.name : `${item.name} · ${tierName(item.tier)}`;
}

/// The second line: the catalogue description ("Moved tickets to Done."), or a neutral line.
export function unlockLine(item: UnlockToastItem): string {
  return item.description ?? 'New achievement unlocked.';
}

export function summaryTitle(items: readonly UnlockToastItem[]): string {
  return `${items.length} new achievements`;
}

/// "Reporter, Connector, Machine whisperer and 2 more." Each achievement is named once, even with
/// several new tiers.
export function summaryLine(items: readonly UnlockToastItem[]): string {
  const names = [...new Set(items.map((i) => i.name))];
  if (names.length === 1) return `${names[0]}.`;
  if (names.length <= SUMMARY_MEDALS) {
    return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}.`;
  }
  const rest = names.length - SUMMARY_MEDALS;
  return `${names.slice(0, SUMMARY_MEDALS).join(', ')} and ${rest} more.`;
}

/// The medals the summary stacks: the first achievements, each at its highest new tier.
export function summaryMedals(items: readonly UnlockToastItem[]): UnlockToastItem[] {
  const byId = new Map<string, UnlockToastItem>();
  for (const item of items) {
    const known = byId.get(item.id);
    if (!known && byId.size === SUMMARY_MEDALS) continue;
    if (!known || item.tier > known.tier) byId.set(item.id, item);
  }
  return [...byId.values()];
}
