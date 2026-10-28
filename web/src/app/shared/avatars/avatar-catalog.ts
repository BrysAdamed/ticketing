import { PALETTE_SIZE } from '@shared/util/hash';

export interface AvatarIcon {
  key: string;
  label: string;
  group: string;
}

/// A user's chosen avatar (D-129): an icon key (null shows initials) and a colour key (null uses
/// the colour hashed from the user id).
export interface UserAvatar {
  icon: string | null;
  color: string | null;
}

/// Mirrors `AvatarCatalog.Icons` in the domain, in the same order; each key has its art in
/// `avatar-art.generated.ts` (D-130).
export const AVATAR_ICONS: readonly AvatarIcon[] = [
  { key: 'dog', label: 'Dog', group: 'Pets' },
  { key: 'cat', label: 'Cat', group: 'Pets' },
  { key: 'mouse', label: 'Mouse', group: 'Pets' },
  { key: 'hamster', label: 'Hamster', group: 'Pets' },
  { key: 'rabbit', label: 'Rabbit', group: 'Pets' },
  { key: 'fish', label: 'Fish', group: 'Pets' },
  { key: 'pig', label: 'Pig', group: 'Farm' },
  { key: 'cow', label: 'Cow', group: 'Farm' },
  { key: 'horse', label: 'Horse', group: 'Farm' },
  { key: 'chick', label: 'Chick', group: 'Farm' },
  { key: 'fox', label: 'Fox', group: 'Wild' },
  { key: 'bear', label: 'Bear', group: 'Wild' },
  { key: 'panda', label: 'Panda', group: 'Wild' },
  { key: 'koala', label: 'Koala', group: 'Wild' },
  { key: 'tiger', label: 'Tiger', group: 'Wild' },
  { key: 'lion', label: 'Lion', group: 'Wild' },
  { key: 'monkey', label: 'Monkey', group: 'Wild' },
  { key: 'wolf', label: 'Wolf', group: 'Wild' },
  { key: 'raccoon', label: 'Raccoon', group: 'Wild' },
  { key: 'hedgehog', label: 'Hedgehog', group: 'Wild' },
  { key: 'otter', label: 'Otter', group: 'Wild' },
  { key: 'sloth', label: 'Sloth', group: 'Wild' },
  { key: 'frog', label: 'Frog', group: 'Wild' },
  { key: 'unicorn', label: 'Unicorn', group: 'Wild' },
  { key: 'owl', label: 'Owl', group: 'Birds' },
  { key: 'penguin', label: 'Penguin', group: 'Birds' },
  { key: 'octopus', label: 'Octopus', group: 'Sea' },
  { key: 'turtle', label: 'Turtle', group: 'Sea' },
  { key: 'whale', label: 'Whale', group: 'Sea' },
  { key: 'bee', label: 'Bee', group: 'Bugs' },
  { key: 'butterfly', label: 'Butterfly', group: 'Bugs' },
  { key: 'bug', label: 'Ladybug', group: 'Bugs' },
];

/// The named `--tk-palette-0..7` colours, in palette order (`AvatarCatalog.Colors`).
export const AVATAR_COLORS = [
  { key: 'blue', label: 'Blue' },
  { key: 'violet', label: 'Violet' },
  { key: 'pink', label: 'Pink' },
  { key: 'orange', label: 'Orange' },
  { key: 'amber', label: 'Amber' },
  { key: 'green', label: 'Green' },
  { key: 'teal', label: 'Teal' },
  { key: 'cyan', label: 'Cyan' },
] as const;

const ICON_KEYS = new Set(AVATAR_ICONS.map((i) => i.key));

export function isAvatarIcon(key: string | null | undefined): key is string {
  return key != null && ICON_KEYS.has(key);
}

/// The palette index of a colour key, or null for none or an unknown key.
export function avatarColorIndex(color: string | null | undefined): number | null {
  const index = AVATAR_COLORS.findIndex((c) => c.key === color);
  return index < 0 || index >= PALETTE_SIZE ? null : index;
}

/// Loads the icon art (a lazy chunk) as `data:` image URLs by key.
export async function loadAvatarArt(): Promise<ReadonlyMap<string, string>> {
  const { AVATAR_ART } = await import('./avatar-art.generated');
  return new Map(
    Object.entries(AVATAR_ART).map(([key, svg]) => [
      key,
      `data:image/svg+xml,${encodeURIComponent(svg)}`,
    ]),
  );
}
