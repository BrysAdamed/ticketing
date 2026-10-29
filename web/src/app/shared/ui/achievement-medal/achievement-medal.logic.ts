export const TIER_NAMES = ['Bronze', 'Silver', 'Gold', 'Platinum'] as const;
export const TIER_KEYS = ['bronze', 'silver', 'gold', 'platinum'] as const;

export type MedalSize = 20 | 32 | 48 | 64;

/// What a medal shows: the highest tier earned (0 for none) out of the achievement's tier count
/// (1 for a one-time achievement, whose single tier reads "Earned").
export interface MedalTier {
  tier: number;
  tierCount: number;
}

export function isOnce({ tierCount }: MedalTier): boolean {
  return tierCount <= 1;
}

/// The tier's name by its ordinal (1 Bronze to 4 Platinum).
export function tierName(tier: number): string {
  return TIER_NAMES[Math.min(Math.max(tier, 1), TIER_NAMES.length) - 1];
}

/// The tier colour token, `var(--tk-tier-gold)`.
export function tierColor(tier: number): string {
  return `var(--tk-tier-${TIER_KEYS[Math.min(Math.max(tier, 1), TIER_KEYS.length) - 1]})`;
}

/// The written tier next to a medal: "Gold", "Earned" for a one-time achievement, "Not earned yet".
export function tierText(medal: MedalTier): string {
  if (medal.tier <= 0) return 'Not earned yet';
  return isOnce(medal) ? 'Earned' : tierName(medal.tier);
}

/// The owner's progress towards the next tier, "23 of 50 to Gold"; null for one-time achievements
/// and at the top tier.
export function progressText(
  count: number,
  nextTier: number | null,
  nextThreshold: number | null,
  tierCount: number,
): string | null {
  if (tierCount <= 1 || nextTier === null || nextThreshold === null) return null;
  return `${count} of ${nextThreshold} to ${tierName(nextTier)}`;
}

export interface MedalLabelInput extends MedalTier {
  name: string | null;
  secret: boolean;
  masked: boolean;
  progress?: string | null;
}

/// The accessible name of a medal or tile: name and tier written out, never tier by colour alone
/// (design-system §8 "Achievement medal").
export function medalLabel(input: MedalLabelInput): string {
  if (input.masked || !input.name) return 'Secret achievement, not earned yet';
  const parts = [input.name];
  if (input.secret) parts.push('secret');
  if (input.tier <= 0) {
    parts.push('not earned yet');
    if (input.progress) parts.push(input.progress);
  } else {
    parts.push(isOnce(input) ? 'earned' : tierName(input.tier));
  }
  return parts.join(', ');
}

/// The x positions of the pips on the 48-unit grid: one per tier reached, 7 units apart.
export function pipPositions(tier: number): number[] {
  const count = Math.min(Math.max(tier, 0), TIER_NAMES.length);
  return Array.from({ length: count }, (_, i) => 24 + (i - (count - 1) / 2) * 7);
}
