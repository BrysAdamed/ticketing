import { UserNotification } from './notification.models';

export interface NotificationGroup {
  label: string;
  items: UserNotification[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const weekday = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' });
const weekdayWithYear = new Intl.DateTimeFormat('en', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

/// "Today", "Yesterday", then "Mon, Oct 26" (with the year when it is not the current one).
export function dayLabel(date: Date, now: Date): string {
  const days = Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.getFullYear() === now.getFullYear()
    ? weekday.format(date)
    : weekdayWithYear.format(date);
}

/// Consecutive notifications (already newest first) grouped by the local day they were created.
export function groupByDay(items: readonly UserNotification[], now: Date): NotificationGroup[] {
  const groups: NotificationGroup[] = [];
  for (const item of items) {
    const label = dayLabel(new Date(item.createdAt), now);
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function badgeText(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? '99+' : String(count);
}

export function bellLabel(count: number): string {
  return count > 0 ? `Notifications, ${count} unread` : 'Notifications';
}

/// "+2 more" for a notification that collapsed three events.
export function moreLabel(eventCount: number): string | null {
  return eventCount > 1 ? `+${eventCount - 1} more` : null;
}

function startOfDay(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}
