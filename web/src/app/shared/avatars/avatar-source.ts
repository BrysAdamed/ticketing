import { InjectionToken } from '@angular/core';
import { paletteIndex } from '@shared/util/hash';
import { avatarColorIndex, isAvatarIcon, UserAvatar } from './avatar-catalog';

/// Where shared UI finds the avatars users chose (core's avatar directory provides it). Both
/// methods may read signals, so callers inside a computed or template update when they change.
export interface AvatarSource {
  /// The avatar the user chose, or null for initials on the hashed colour.
  avatarOf(userId: string): UserAvatar | null;
  /// The image URL of an icon key, or null while the art is loading.
  imageOf(icon: string): string | null;
}

export const AVATAR_SOURCE = new InjectionToken<AvatarSource>('AVATAR_SOURCE');

/// How to draw one avatar: the image of `icon` (`src`), a blank tint while it loads (`pending`),
/// or initials (no `icon`); always on `palette`.
export interface ResolvedAvatar {
  palette: number;
  icon: string | null;
  src: string | null;
  pending: boolean;
}

/// Resolves a user's avatar: the chosen colour, else the colour hashed from `seed`; the chosen
/// icon when it is still in the catalogue, else initials.
export function resolveAvatar(
  source: AvatarSource | null,
  userId: string | null | undefined,
  seed: string,
): ResolvedAvatar {
  const chosen = source && userId ? source.avatarOf(userId) : null;
  const palette = avatarColorIndex(chosen?.color) ?? paletteIndex(seed);
  const icon = chosen?.icon;
  if (!source || !isAvatarIcon(icon)) return { palette, icon: null, src: null, pending: false };
  const src = source.imageOf(icon);
  return { palette, icon, src, pending: src === null };
}
