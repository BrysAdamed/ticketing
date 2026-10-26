import { Pipe, PipeTransform } from '@angular/core';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const monthDay = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' });
const monthDayYear = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});
const full = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' });

/// "just now", "5m ago", "3h ago", "yesterday", "4d ago", then "Oct 22" / "Oct 22, 2025".
export function relativeTime(
  value: string | number | Date | null | undefined,
  now = Date.now(),
): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  const time = date.getTime();
  if (Number.isNaN(time)) return '';
  const diff = now - time;
  if (diff < 0) return monthDay.format(date);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)}m ago`;
  if (diff < DAY) return `${Math.floor(diff / HOUR)}h ago`;
  if (diff < 2 * DAY) return 'yesterday';
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)}d ago`;
  return new Date(now).getFullYear() === date.getFullYear()
    ? monthDay.format(date)
    : monthDayYear.format(date);
}

export function absoluteTime(value: string | number | Date | null | undefined): string {
  if (value === null || value === undefined || value === '') return '';
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : full.format(date);
}

/// `{{ ticket.updatedAt | relativeTime }}`; pair with `[title]="x | absoluteTime"`.
@Pipe({ name: 'relativeTime' })
export class RelativeTimePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined): string {
    return relativeTime(value);
  }
}

@Pipe({ name: 'absoluteTime' })
export class AbsoluteTimePipe implements PipeTransform {
  transform(value: string | number | Date | null | undefined): string {
    return absoluteTime(value);
  }
}
