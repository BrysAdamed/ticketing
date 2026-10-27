import {
  PRIORITY_LABELS,
  Priority,
  RESOLUTION_LABELS,
  Resolution,
  SEVERITY_LABELS,
  Severity,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
  TicketStatus,
  TicketType,
  WRITE_CHANNEL_LABELS,
} from '@shared/domain/enums';
import { ActivityEntry, UserRef } from '@core/tickets/ticket.models';

/// One rendered history line: "Anna changed status To Do → In Progress".
export interface ActivityLine {
  id: string;
  occurredAt: string;
  actor: string;
  icon: string;
  verb: string;
  from: string | null;
  to: string | null;
  /// A ticket key mentioned by the entry (links), rendered as a link.
  ticketKey: string | null;
  channel: string | null;
}

/// Entries of one operation share `occurredAt` and actor; the UI shows them as one group.
export interface ActivityGroup {
  key: string;
  occurredAt: string;
  actor: string;
  channel: string | null;
  lines: ActivityLine[];
}

const FIELD_LABELS: Record<string, string> = {
  title: 'title',
  description: 'description',
  type: 'type',
  status: 'status',
  resolution: 'resolution',
  priority: 'priority',
  severity: 'severity',
  storyPoints: 'story points',
  version: 'version',
  labels: 'labels',
  parent: 'parent',
  assignee: 'assignee',
  reporter: 'reporter',
};

const FIELD_ICONS: Record<string, string> = {
  status: 'tablerArrowRight',
  assignee: 'tablerUser',
  reporter: 'tablerUser',
  labels: 'tablerTag',
  parent: 'tablerHierarchy',
  description: 'tablerFileText',
  title: 'tablerPencil',
};

export function userName(user: UserRef | null | undefined): string {
  if (!user) return 'Someone';
  return user.isActive ? user.displayName : `${user.displayName} (deactivated)`;
}

export function formatValue(
  field: string,
  value: unknown,
  users: ReadonlyMap<string, UserRef>,
): string | null {
  if (value === null || value === undefined || value === '') return null;
  switch (field) {
    case 'status':
      return TICKET_STATUS_LABELS[value as TicketStatus] ?? String(value);
    case 'type':
      return TICKET_TYPE_LABELS[value as TicketType] ?? String(value);
    case 'priority':
      return PRIORITY_LABELS[value as Priority] ?? String(value);
    case 'severity':
      return SEVERITY_LABELS[value as Severity] ?? String(value);
    case 'resolution':
      return RESOLUTION_LABELS[value as Resolution] ?? String(value);
    case 'assignee':
    case 'reporter':
      return userName(users.get(String(value)));
    case 'labels':
      return Array.isArray(value) ? value.join(', ') : String(value);
    default:
      return typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : JSON.stringify(value);
  }
}

export function describeEntry(
  entry: ActivityEntry,
  users: ReadonlyMap<string, UserRef>,
): ActivityLine {
  const base = {
    id: entry.id,
    occurredAt: entry.occurredAt,
    actor: entry.actor ? userName(entry.actor) : 'System',
    channel: entry.channel && entry.channel !== 'Web' ? WRITE_CHANNEL_LABELS[entry.channel] : null,
    from: null,
    to: null,
    ticketKey: null,
  };
  const value = (entry.newValue ?? {}) as Record<string, unknown>;

  switch (entry.action) {
    case 'ticket.created':
      return { ...base, icon: 'tablerPlus', verb: 'created the ticket' };
    case 'ticket.deleted':
      return { ...base, icon: 'tablerTrash', verb: 'deleted the ticket' };
    case 'ticket.moved':
      return {
        ...base,
        icon: 'tablerArrowsExchange',
        verb: entry.newValue ? 'moved the ticket to a board' : 'moved the ticket to the backlog',
      };
    case 'comment.added':
      return { ...base, icon: 'tablerMessage', verb: 'commented' };
    case 'attachment.added':
      return { ...base, icon: 'tablerPlus', verb: `attached ${attachmentName(entry.newValue)}` };
    case 'attachment.removed':
      return {
        ...base,
        icon: 'tablerTrash',
        verb: `removed the attachment ${attachmentName(entry.newValue)}`,
      };
    case 'comment.edited':
      return { ...base, icon: 'tablerPencil', verb: 'edited a comment' };
    case 'comment.deleted':
      return { ...base, icon: 'tablerTrash', verb: 'deleted a comment' };
    case 'ticket.link.added':
    case 'ticket.link.removed': {
      const label = linkLabel(String(value['type'] ?? ''), String(value['direction'] ?? 'Outward'));
      const verb =
        entry.action === 'ticket.link.added' ? `linked: ${label}` : `removed link: ${label}`;
      return {
        ...base,
        icon: 'tablerLink',
        verb,
        ticketKey: typeof value['key'] === 'string' ? value['key'] : null,
      };
    }
    case 'ticket.field.changed':
      return describeFieldChange(entry, users, base);
    default:
      return { ...base, icon: 'tablerPoint', verb: entry.action };
  }
}

function describeFieldChange(
  entry: ActivityEntry,
  users: ReadonlyMap<string, UserRef>,
  base: Omit<ActivityLine, 'icon' | 'verb'>,
): ActivityLine {
  const field = entry.field ?? '';
  const label = FIELD_LABELS[field] ?? field;
  const icon = FIELD_ICONS[field] ?? 'tablerPencil';
  if (field === 'description')
    return {
      ...base,
      icon,
      verb: entry.newValue ? 'updated the description' : 'cleared the description',
    };
  if (field === 'labels') {
    const before = asStrings(entry.oldValue);
    const after = asStrings(entry.newValue);
    const added = after.filter((l) => !before.includes(l));
    const removed = before.filter((l) => !after.includes(l));
    const parts = [
      added.length ? `added ${plural('label', added)} ${added.join(', ')}` : '',
      removed.length ? `removed ${plural('label', removed)} ${removed.join(', ')}` : '',
    ];
    return { ...base, icon, verb: parts.filter(Boolean).join(' and ') || 'changed labels' };
  }
  const from = formatValue(field, entry.oldValue, users);
  const to = formatValue(field, entry.newValue, users);
  if (from === null && to !== null)
    return {
      ...base,
      icon,
      verb: `set ${label} to`,
      to,
      ticketKey: field === 'parent' ? to : null,
    };
  if (to === null) return { ...base, icon, verb: `cleared ${label}`, from };
  return {
    ...base,
    icon,
    verb: `changed ${label}`,
    from,
    to,
    ticketKey: field === 'parent' ? to : null,
  };
}

export function groupEntries(lines: readonly ActivityLine[]): ActivityGroup[] {
  const groups: ActivityGroup[] = [];
  for (const line of lines) {
    const last = groups[groups.length - 1];
    if (last && last.occurredAt === line.occurredAt && last.actor === line.actor)
      last.lines.push(line);
    else
      groups.push({
        key: line.id,
        occurredAt: line.occurredAt,
        actor: line.actor,
        channel: line.channel,
        lines: [line],
      });
  }
  return groups;
}

function linkLabel(type: string, direction: string): string {
  const outward: Record<string, string> = {
    Blocks: 'blocks',
    RelatesTo: 'relates to',
    Duplicates: 'duplicates',
  };
  const inward: Record<string, string> = {
    Blocks: 'is blocked by',
    RelatesTo: 'relates to',
    Duplicates: 'is duplicated by',
  };
  return (direction === 'Inward' ? inward : outward)[type] ?? type;
}

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

function plural(word: string, items: readonly unknown[]): string {
  return items.length === 1 ? word : `${word}s`;
}

function attachmentName(value: unknown): string {
  return typeof value === 'object' && value !== null && 'fileName' in value
    ? String((value as { fileName: unknown }).fileName)
    : 'a file';
}
