import {
  PRIORITIES,
  Priority,
  STATUS_CATEGORIES,
  statusCategory,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  TicketStatus,
  TicketType,
} from '@shared/domain/enums';
import { BacklogItem, BacklogParent, UserRef } from '@core/tickets/ticket.models';

export type GroupBy = 'status' | 'type' | 'assignee' | 'epic' | 'none';
export type SortBy = 'rank' | 'priority' | 'updated' | 'created';

export const GROUP_BY_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: 'status', label: 'Status' },
  { value: 'type', label: 'Type' },
  { value: 'epic', label: 'Epic' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'none', label: 'None' },
];

export const SORT_BY_OPTIONS: readonly { value: SortBy; label: string }[] = [
  { value: 'rank', label: 'Rank' },
  { value: 'priority', label: 'Priority' },
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
];

export interface BacklogFilters {
  showDone: boolean;
  types: TicketType[];
  statuses: TicketStatus[];
  priorities: Priority[];
  /// User id, `me`, `unassigned` or null.
  assignee: string | null;
  labels: string[];
  version: string | null;
  text: string;
}

export const EMPTY_FILTERS: BacklogFilters = {
  showDone: false,
  types: [],
  statuses: [],
  priorities: [],
  assignee: null,
  labels: [],
  version: null,
  text: '',
};

export function activeFilterCount(filters: BacklogFilters): number {
  return (
    (filters.types.length ? 1 : 0) +
    (filters.statuses.length ? 1 : 0) +
    (filters.priorities.length ? 1 : 0) +
    (filters.assignee ? 1 : 0) +
    (filters.labels.length ? 1 : 0) +
    (filters.version ? 1 : 0) +
    (filters.text.trim() ? 1 : 0)
  );
}

/// Client-side mirror of the server filter, so optimistic edits (for example status → Done)
/// immediately add or remove rows without a refetch.
export function matchesFilters(
  item: BacklogItem,
  filters: BacklogFilters,
  meId: string | null,
): boolean {
  if (!filters.showDone && filters.statuses.length === 0 && item.status === 'Done') return false;
  if (filters.types.length && !filters.types.includes(item.type)) return false;
  if (filters.statuses.length && !filters.statuses.includes(item.status)) return false;
  if (filters.priorities.length && !filters.priorities.includes(item.priority)) return false;
  if (filters.version && item.version !== filters.version) return false;
  if (filters.labels.length && !filters.labels.every((l) => item.labels.includes(l.toLowerCase())))
    return false;
  if (filters.assignee === 'unassigned' && item.assigneeId !== null) return false;
  if (filters.assignee === 'me' && item.assigneeId !== meId) return false;
  if (
    filters.assignee &&
    !['me', 'unassigned'].includes(filters.assignee) &&
    item.assigneeId !== filters.assignee
  )
    return false;
  const text = filters.text.trim().toLowerCase();
  if (text) {
    const number = keyNumber(text);
    const titleMatch = item.title.toLowerCase().includes(text);
    if (!titleMatch && (number === null || keyNumber(item.key) !== number)) return false;
  }
  return true;
}

function keyNumber(value: string): number | null {
  const match = /^(?:[a-z][a-z0-9]{1,9}-)?(\d+)$/i.exec(value.trim());
  return match ? Number(match[1]) : null;
}

export interface GroupRow {
  kind: 'group';
  id: string;
  label: string;
  /// The field value a ticket gets when dropped or created in this group.
  value: string | null;
  icon: GroupIcon;
  count: number;
  points: number;
  collapsed: boolean;
}

export type GroupIcon =
  | { kind: 'status'; status: TicketStatus }
  | { kind: 'type'; type: TicketType }
  | { kind: 'user'; user: UserRef | null }
  | { kind: 'epic'; parent: BacklogParent | null }
  | { kind: 'none' };

export interface TicketRow {
  kind: 'ticket';
  id: string;
  item: BacklogItem;
  groupId: string;
}

export type BacklogRow = GroupRow | TicketRow;

/// Groups ordered by category: in progress → to do → done (layout-and-screens §3.2); On Hold
/// sits at the end of the in-progress block as in the mockup.
export const STATUS_GROUP_ORDER: readonly TicketStatus[] = [
  'InProgress',
  'Review',
  'ReadyForTesting',
  'Testing',
  'ReadyForDeploy',
  'OnHold',
  'ToDo',
  'Done',
];

const PRIORITY_RANK = new Map(PRIORITIES.map((p, i) => [p, i]));

export function sortItems(items: readonly BacklogItem[], sortBy: SortBy): BacklogItem[] {
  const result = [...items];
  switch (sortBy) {
    case 'priority':
      return result.sort(
        (a, b) => (PRIORITY_RANK.get(a.priority) ?? 0) - (PRIORITY_RANK.get(b.priority) ?? 0),
      );
    case 'updated':
      return result.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    case 'created':
      return result.sort((a, b) => (keyNumber(b.key) ?? 0) - (keyNumber(a.key) ?? 0));
    default:
      return result;
  }
}

export interface GroupContext {
  users: ReadonlyMap<string, UserRef>;
  parents: ReadonlyMap<string, BacklogParent>;
  collapsed: ReadonlySet<string>;
  showEmpty: boolean;
  /// A group shown even when empty (the quick-create target).
  keepGroup?: string | null;
}

/// Flattens items into header + ticket rows for the virtual-scroll list.
export function buildRows(
  items: readonly BacklogItem[],
  groupBy: GroupBy,
  context: GroupContext,
): BacklogRow[] {
  if (groupBy === 'none')
    return items.map((item) => ({ kind: 'ticket', id: item.id, item, groupId: 'all' }));

  const groups = new Map<
    string,
    { header: Omit<GroupRow, 'count' | 'points' | 'collapsed'>; items: BacklogItem[] }
  >();
  for (const definition of groupDefinitions(groupBy, items, context)) {
    groups.set(definition.id, { header: definition, items: [] });
  }
  for (const item of items) {
    const id = groupIdOf(item, groupBy);
    let group = groups.get(id);
    if (!group) {
      group = { header: describeGroup(groupBy, id, context), items: [] };
      groups.set(id, group);
    }
    group.items.push(item);
  }

  const rows: BacklogRow[] = [];
  for (const [id, group] of groups) {
    if (group.items.length === 0 && !context.showEmpty && id !== context.keepGroup) continue;
    const collapsed = context.collapsed.has(id);
    rows.push({
      ...group.header,
      kind: 'group',
      count: group.items.length,
      points: group.items.reduce((sum, i) => sum + (i.storyPoints ?? 0), 0),
      collapsed,
    });
    if (!collapsed) {
      for (const item of group.items) rows.push({ kind: 'ticket', id: item.id, item, groupId: id });
    }
  }
  return rows;
}

export function groupIdOf(item: BacklogItem, groupBy: GroupBy): string {
  switch (groupBy) {
    case 'status':
      return `status:${item.status}`;
    case 'type':
      return `type:${item.type}`;
    case 'assignee':
      return `assignee:${item.assigneeId ?? ''}`;
    case 'epic':
      return `epic:${item.parentId ?? ''}`;
    default:
      return 'all';
  }
}

function groupDefinitions(
  groupBy: GroupBy,
  items: readonly BacklogItem[],
  context: GroupContext,
): Omit<GroupRow, 'count' | 'points' | 'collapsed'>[] {
  switch (groupBy) {
    case 'status':
      return STATUS_GROUP_ORDER.map((status) =>
        describeGroup('status', `status:${status}`, context),
      );
    case 'type':
      return TICKET_TYPES.map((type) => describeGroup('type', `type:${type}`, context));
    case 'assignee': {
      const ids = [...new Set(items.map((i) => i.assigneeId ?? ''))];
      const named = ids
        .filter((id) => id !== '')
        .sort((a, b) =>
          (context.users.get(a)?.displayName ?? '').localeCompare(
            context.users.get(b)?.displayName ?? '',
          ),
        );
      return [...named, ''].map((id) => describeGroup('assignee', `assignee:${id}`, context));
    }
    case 'epic': {
      const ids = [...new Set(items.map((i) => i.parentId ?? ''))].filter((id) => id !== '');
      return [...ids, ''].map((id) => describeGroup('epic', `epic:${id}`, context));
    }
    default:
      return [];
  }
}

function describeGroup(
  groupBy: GroupBy,
  id: string,
  context: GroupContext,
): Omit<GroupRow, 'count' | 'points' | 'collapsed'> {
  const value = id.slice(id.indexOf(':') + 1);
  switch (groupBy) {
    case 'status': {
      const status = value as TicketStatus;
      return {
        kind: 'group',
        id,
        label: TICKET_STATUS_LABELS[status],
        value: status,
        icon: { kind: 'status', status },
      };
    }
    case 'type': {
      const type = value as TicketType;
      return {
        kind: 'group',
        id,
        label: TICKET_TYPE_LABELS[type],
        value: type,
        icon: { kind: 'type', type },
      };
    }
    case 'assignee': {
      const user = value ? (context.users.get(value) ?? null) : null;
      return {
        kind: 'group',
        id,
        label: value ? (user?.displayName ?? 'Unknown user') : 'Unassigned',
        value: value || null,
        icon: { kind: 'user', user },
      };
    }
    case 'epic': {
      const parent = value ? (context.parents.get(value) ?? null) : null;
      return {
        kind: 'group',
        id,
        label: value ? (parent ? `${parent.key} ${parent.title}` : 'Parent') : 'No parent',
        value: parent?.key ?? null,
        icon: { kind: 'epic', parent },
      };
    }
    default:
      return { kind: 'group', id, label: 'All', value: null, icon: { kind: 'none' } };
  }
}

/// Moves `ids` as one block (in the given order) so it lands right before `beforeId`, or after
/// `afterId`, or at the very top/bottom. Mirrors the server's rank semantics for optimistic UI.
export function moveBlock(
  items: readonly BacklogItem[],
  ids: readonly string[],
  anchor: { beforeId?: string; afterId?: string; position?: 'Top' | 'Bottom' },
): BacklogItem[] {
  const moving = new Set(ids);
  const byId = new Map(items.map((i) => [i.id, i]));
  const block = ids.map((id) => byId.get(id)).filter((i): i is BacklogItem => i !== undefined);
  const rest = items.filter((i) => !moving.has(i.id));
  let index: number;
  if (anchor.beforeId) index = rest.findIndex((i) => i.id === anchor.beforeId);
  else if (anchor.afterId) {
    const at = rest.findIndex((i) => i.id === anchor.afterId);
    index = at < 0 ? -1 : at + 1;
  } else index = anchor.position === 'Top' ? 0 : rest.length;
  if (index < 0) index = rest.length;
  return [...rest.slice(0, index), ...block, ...rest.slice(index)];
}

export interface DropPlan {
  /// The rank request anchor.
  anchor: { beforeKey?: string; afterKey?: string; position?: 'Top' | 'Bottom' };
  /// Optimistic anchor by id for `moveBlock`.
  local: { beforeId?: string; afterId?: string; position?: 'Top' | 'Bottom' };
}

/// Works out where a block dropped at `targetIndex` of the visible rows goes. The anchor is the next
/// visible ticket in the same group, or failing that the previous one; an empty group keeps the rank.
export function planDrop(
  rows: readonly { kind: string }[],
  movingIds: ReadonlySet<string>,
  targetIndex: number,
  groupId: string,
): DropPlan | null {
  const visible = rows.filter(
    (r): r is TicketRow =>
      r.kind === 'ticket' &&
      (r as TicketRow).groupId === groupId &&
      !movingIds.has((r as TicketRow).id),
  );
  const indexInRows = (row: TicketRow) => rows.indexOf(row);
  const next = visible.find((r) => indexInRows(r) >= targetIndex);
  if (next) return { anchor: { beforeKey: next.item.key }, local: { beforeId: next.id } };
  const previous = [...visible].reverse().find((r) => indexInRows(r) < targetIndex);
  if (previous) return { anchor: { afterKey: previous.item.key }, local: { afterId: previous.id } };
  return null;
}

export interface StickyGroup {
  group: GroupRow;
  /// 0, or negative while the next group header pushes this one out of view.
  offset: number;
}

/// The group header to pin over a fixed-row-height virtual list scrolled to scrollTop: the last
/// header at or above the first visible row. Null at the very top (the real header is in place) and
/// when the list is not grouped.
export function stickyGroupAt(
  rows: readonly { kind: string }[],
  scrollTop: number,
  rowHeight: number,
): StickyGroup | null {
  if (scrollTop <= 0 || rowHeight <= 0 || rows.length === 0) return null;
  const top = Math.min(Math.floor(scrollTop / rowHeight), rows.length - 1);
  let group: GroupRow | null = null;
  for (let i = top; i >= 0 && !group; i--)
    if (rows[i].kind === 'group') group = rows[i] as GroupRow;
  if (!group) return null;
  const next = rows.findIndex((r, i) => i > top && r.kind === 'group');
  const nextTop = next === -1 ? Infinity : next * rowHeight - scrollTop;
  return { group, offset: nextTop < rowHeight ? nextTop - rowHeight : 0 };
}

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/// Where a dragged backlog row would land: a board of the "On boards" panel, the panel itself (no
/// board under the pointer, so the drop does nothing) or the list (reorder). Boards scrolled out of
/// the panel do not count.
export type DragTarget = { kind: 'board'; boardId: string } | { kind: 'panel' } | { kind: 'list' };

export function dragTargetAt(
  x: number,
  y: number,
  panel: Box | null,
  boards: readonly { id: string; box: Box }[],
): DragTarget {
  const inside = (box: Box) => x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  if (!panel || !inside(panel)) return { kind: 'list' };
  const board = boards.find((b) => inside(b.box));
  return board ? { kind: 'board', boardId: board.id } : { kind: 'panel' };
}

export function categoryOrder(status: TicketStatus): number {
  return STATUS_CATEGORIES.indexOf(statusCategory(status));
}

export const ALL_STATUSES = TICKET_STATUSES;
