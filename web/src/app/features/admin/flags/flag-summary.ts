import { GlobalRole } from '@shared/domain/enums';

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

/// Declared flags by key, then the retired ones (no longer read by the code) by key (D-168).
export function groupFlags<T extends { key: string; retired: boolean }>(
  flags: readonly T[],
): { declared: T[]; retired: T[] } {
  const byKey = [...flags].sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    declared: byKey.filter((f) => !f.retired),
    retired: byKey.filter((f) => f.retired),
  };
}
