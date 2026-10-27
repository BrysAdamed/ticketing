import { DocHistoryItem } from '@core/docs/doc-history.api';
import { WriteChannel } from '@core/docs/doc.models';

/// The two versions a history view compares: `from` null means `to` is the first version.
export interface Comparison {
  from: number | null;
  to: number;
}

/// What the history shows for the selected version (`?history=n`) and an optional second one
/// (`&with=m`): two versions compare oldest to newest; an older version alone compares with the
/// current one (what restoring it would change); the current one alone shows its own changes.
export function comparison(selected: number, current: number, other: number | null): Comparison {
  if (other !== null && other !== selected)
    return { from: Math.min(selected, other), to: Math.max(selected, other) };
  if (selected >= current) return { from: current > 1 ? current - 1 : null, to: current };
  return { from: selected, to: current };
}

/// A version number from a query parameter, or null when missing or not a version.
export function versionParam(value: string | null, current: number): number | null {
  if (value === null || !/^\d+$/.test(value)) return null;
  const number = Number(value);
  return number >= 1 && number <= current ? number : null;
}

export interface ActivityLine {
  icon: string;
  text: string;
}

/// One line for an activity entry of the history (spec 1.12); unknown actions show as recorded.
export function describeActivity(item: DocHistoryItem): ActivityLine {
  const next = item.newValue as Record<string, unknown> | string | null;
  const previous = item.oldValue as Record<string, unknown> | string | null;
  switch (item.action) {
    case 'doc.created':
      return { icon: 'tablerPlus', text: 'Created' };
    case 'doc.renamed':
      return {
        icon: 'tablerCursorText',
        text: `Renamed from “${String(previous ?? '')}” to “${String(next ?? '')}”`,
      };
    case 'doc.moved':
      return {
        icon: 'tablerFolderSymlink',
        text: typeof next === 'string' ? `Moved to ${next}` : 'Moved to the top level',
      };
    case 'doc.deleted':
      return { icon: 'tablerTrash', text: 'Deleted' };
    case 'doc.restored':
      return { icon: 'tablerArrowBackUp', text: 'Restored from the trash' };
    case 'doc.attachment.added':
      return { icon: 'tablerPaperclip', text: `Attached ${fileName(next)}` };
    case 'doc.attachment.deleted':
      return { icon: 'tablerPaperclip', text: `Removed ${fileName(next ?? previous)}` };
    case 'doc.comment.added':
      return { icon: 'tablerMessage', text: 'Commented' };
    case 'doc.comment.edited':
      return { icon: 'tablerMessage', text: 'Edited a comment' };
    case 'doc.comment.deleted':
      return { icon: 'tablerMessage', text: 'Deleted a comment' };
    default:
      return { icon: 'tablerHistory', text: item.action ?? 'Changed' };
  }
}

/// "via MCP" / "via API"; web edits need no label.
export function channelLabel(channel: WriteChannel | null): string | null {
  if (channel === 'Mcp') return 'via MCP';
  if (channel === 'Api') return 'via API';
  return null;
}

export interface HistoryDay {
  label: string;
  items: DocHistoryItem[];
}

/// Groups newest-first entries by local day: "Today", "Yesterday", "Oct 22" (with the year when
/// it is not this year).
export function groupByDay(items: readonly DocHistoryItem[], now = new Date()): HistoryDay[] {
  const days: HistoryDay[] = [];
  for (const item of items) {
    const label = dayLabel(new Date(item.at), now);
    const last = days.at(-1);
    if (last?.label === label) last.items.push(item);
    else days.push({ label, items: [item] });
  }
  return days;
}

function dayLabel(date: Date, now: Date): string {
  const day = startOfDay(date);
  const today = startOfDay(now);
  if (day === today) return 'Today';
  if (today - day === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' }),
  });
}

function startOfDay(date: Date): number {
  return Math.round(
    new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000,
  );
}

function fileName(value: unknown): string {
  const name = (value as { fileName?: unknown } | null)?.fileName;
  return typeof name === 'string' ? name : 'a file';
}
