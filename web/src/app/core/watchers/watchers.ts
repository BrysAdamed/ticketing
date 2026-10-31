import { UserRef, Watchers } from '@core/tickets/ticket.models';

export const NO_WATCHERS: Watchers = { count: 0, watching: false, users: [] };

/// The optimistic list after the signed-in user starts watching: added once, ordered by name like the API.
export function withWatcher(watchers: Watchers, me: UserRef): Watchers {
  if (watchers.users.some((u) => u.id === me.id)) return { ...watchers, watching: true };
  const users = [...watchers.users, me].sort((a, b) =>
    a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }),
  );
  return { count: watchers.count + 1, watching: true, users };
}

export function withoutWatcher(watchers: Watchers, userId: string): Watchers {
  const listed = watchers.users.some((u) => u.id === userId);
  return {
    count: listed ? Math.max(0, watchers.count - 1) : watchers.count,
    watching: false,
    users: watchers.users.filter((u) => u.id !== userId),
  };
}
