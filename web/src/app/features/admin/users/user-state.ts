import { BadgeTone } from '@shared/ui/domain/badge.component';
import { AdminUser } from '../admin.models';

/// What the users table shows in its status column. Only `isActive` is stored; the rest follows
/// from the password, the pending link and the lockout (docs/domain/workflows.md §7).
export type UserState = 'active' | 'locked' | 'invited' | 'linkExpired' | 'deactivated';

export const USER_STATES: Record<UserState, { label: string; tone: BadgeTone; hint: string }> = {
  active: { label: 'Active', tone: 'green', hint: 'Can sign in.' },
  locked: {
    label: 'Locked',
    tone: 'amber',
    hint: 'Locked after 5 failed sign-ins; unlocks after 15 minutes or with a new set-password link.',
  },
  invited: {
    label: 'Invited',
    tone: 'blue',
    hint: 'Has a set-password link and has not used it yet.',
  },
  linkExpired: {
    label: 'Link expired',
    tone: 'amber',
    hint: 'Never set a password and has no valid link. Issue a new one.',
  },
  deactivated: {
    label: 'Deactivated',
    tone: 'muted',
    hint: 'Cannot sign in; tokens were revoked.',
  },
};

export function userState(
  user: Pick<AdminUser, 'isActive' | 'hasPassword' | 'setPasswordLinkExpiresAt' | 'lockedUntil'>,
  now = Date.now(),
): UserState {
  if (!user.isActive) return 'deactivated';
  if (!user.hasPassword) {
    const linkValid =
      user.setPasswordLinkExpiresAt !== null && Date.parse(user.setPasswordLinkExpiresAt) > now;
    return linkValid ? 'invited' : 'linkExpired';
  }
  if (user.lockedUntil !== null && Date.parse(user.lockedUntil) > now) return 'locked';
  return 'active';
}
