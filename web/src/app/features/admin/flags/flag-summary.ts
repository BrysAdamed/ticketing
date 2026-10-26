import { GlobalRole } from '@shared/domain/enums';

/// Flag keys: lower-case words separated by '.' or '-' (spec 4.15), at most 64 characters.
export const FLAG_KEY_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

/// One-line targeting summary for the flags table: "Everyone", "25% · Roles: Admin · 3 users".
export function targetingSummary(flag: {
  rolloutPercentage: number;
  targetRoles: readonly GlobalRole[];
  targetUsers: readonly unknown[];
}): string {
  if (flag.rolloutPercentage >= 100) return 'Everyone';
  const parts: string[] = [];
  if (flag.rolloutPercentage > 0) parts.push(`${flag.rolloutPercentage}% of users`);
  if (flag.targetRoles.length > 0) parts.push(`Roles: ${flag.targetRoles.join(', ')}`);
  const users = flag.targetUsers.length;
  if (users > 0) parts.push(users === 1 ? '1 user' : `${users} users`);
  return parts.length > 0 ? parts.join(' · ') : 'Nobody targeted';
}
