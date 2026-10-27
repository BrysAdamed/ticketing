import { Board, BoardCard, BoardColumn, BoardParent } from '@core/boards/board.models';
import { UserRef } from '@core/tickets/ticket.models';
import { TICKET_STATUSES, TicketStatus, TicketType } from '@shared/domain/enums';

export const UNASSIGNED = 'unassigned';

/// Quick filters (I-29), all applied in the browser and kept in the URL.
export interface BoardFilters {
  assignees: string[];
  types: TicketType[];
  labels: string[];
  projects: string[];
  mine: boolean;
  text: string;
}

export const EMPTY_FILTERS: BoardFilters = {
  assignees: [],
  types: [],
  labels: [],
  projects: [],
  mine: false,
  text: '',
};

export type Swimlanes = 'none' | 'assignee' | 'epic';

export interface Lane {
  key: string;
  label: string;
  user: UserRef | null;
  epic: BoardParent | null;
  cells: Record<TicketStatus, BoardCard[]>;
  count: number;
  points: number;
}

export interface MoveAnchor {
  beforeId?: string;
  afterId?: string;
}

export function hasActiveFilters(filters: BoardFilters): boolean {
  return (
    filters.mine ||
    filters.text.trim() !== '' ||
    filters.assignees.length > 0 ||
    filters.types.length > 0 ||
    filters.labels.length > 0 ||
    filters.projects.length > 0
  );
}

export function cardMatches(card: BoardCard, filters: BoardFilters, meId: string | null): boolean {
  if (filters.mine && card.assigneeId !== meId) return false;
  if (filters.assignees.length && !filters.assignees.includes(card.assigneeId ?? UNASSIGNED))
    return false;
  if (filters.types.length && !filters.types.includes(card.type)) return false;
  if (filters.projects.length && !filters.projects.includes(card.projectKey)) return false;
  if (filters.labels.length && !filters.labels.some((l) => card.labels.includes(l))) return false;
  const text = filters.text.trim().toLowerCase();
  return !text || card.title.toLowerCase().includes(text) || card.key.toLowerCase().includes(text);
}

/// The epic a card belongs to: its parent when that is an epic, otherwise its grandparent when that is one.
export function epicOf(
  card: BoardCard,
  parents: ReadonlyMap<string, BoardParent>,
): BoardParent | null {
  if (card.type === 'Epic' || !card.parentId) return null;
  const parent = parents.get(card.parentId);
  if (!parent) return null;
  if (parent.type === 'Epic') return parent;
  const grand = parent.parentId ? parents.get(parent.parentId) : undefined;
  return grand?.type === 'Epic' ? grand : null;
}

/// Groups the visible cards into swimlanes (rows), each with one cell per status. Lanes keep the
/// board order inside every cell. Assignee lanes sort by name with Unassigned last; epic lanes by
/// key with "No epic" last. Lanes without visible cards are left out.
export function buildLanes(
  board: Board,
  filters: BoardFilters,
  swimlanes: Swimlanes,
  meId: string | null,
): Lane[] {
  const users = new Map(board.users.map((u) => [u.id, u]));
  const parents = new Map(board.parents.map((p) => [p.id, p]));
  const lanes = new Map<string, Lane>();

  const laneFor = (card: BoardCard): Lane => {
    let key = '';
    let label = '';
    let user: UserRef | null = null;
    let epic: BoardParent | null = null;
    if (swimlanes === 'assignee') {
      user = card.assigneeId ? (users.get(card.assigneeId) ?? null) : null;
      key = user?.id ?? UNASSIGNED;
      label = user?.displayName ?? 'Unassigned';
    } else if (swimlanes === 'epic') {
      epic = epicOf(card, parents);
      key = epic?.id ?? 'none';
      label = epic ? epic.title : 'No epic';
    }
    let lane = lanes.get(key);
    if (!lane) {
      lane = { key, label, user, epic, cells: emptyCells(), count: 0, points: 0 };
      lanes.set(key, lane);
    }
    return lane;
  };

  for (const column of board.columns) {
    for (const card of column.cards) {
      if (!cardMatches(card, filters, meId)) continue;
      const lane = laneFor(card);
      lane.cells[column.status].push(card);
      lane.count++;
      lane.points += card.storyPoints ?? 0;
    }
  }

  if (swimlanes === 'none')
    return [
      lanes.get('') ?? {
        key: '',
        label: '',
        user: null,
        epic: null,
        cells: emptyCells(),
        count: 0,
        points: 0,
      },
    ];
  const fallback = swimlanes === 'assignee' ? UNASSIGNED : 'none';
  return [...lanes.values()].sort((a, b) => {
    if (a.key === fallback) return 1;
    if (b.key === fallback) return -1;
    return swimlanes === 'epic'
      ? compareKeys(a.epic!.key, b.epic!.key)
      : a.label.localeCompare(b.label);
  });
}

/// Where a block of cards lands when dropped at `index` of a visible cell. `visible` is the cell as
/// displayed before the drop; the dragged and other moving cards are skipped as neighbours, like the
/// server does. Hidden (filtered) cards are not considered: the anchor is the nearest visible card.
export function anchorFor(
  visible: readonly BoardCard[],
  draggedId: string,
  index: number,
  moving: ReadonlySet<string>,
): MoveAnchor {
  const rest = visible.filter((c) => c.id !== draggedId);
  for (let i = index; i < rest.length; i++) {
    if (!moving.has(rest[i].id)) return { beforeId: rest[i].id };
  }
  for (let i = Math.min(index, rest.length) - 1; i >= 0; i--) {
    if (!moving.has(rest[i].id)) return { afterId: rest[i].id };
  }
  return {};
}

/// The optimistic version of a move: the cards leave their columns and land in `status` before or
/// after the anchor (or at the bottom), in the order given. Returns new column arrays only where they change.
export function applyMove(
  columns: readonly BoardColumn[],
  ids: readonly string[],
  status: TicketStatus,
  anchor: MoveAnchor,
): BoardColumn[] {
  const moving = new Set(ids);
  const byId = new Map<string, BoardCard>();
  for (const column of columns)
    for (const card of column.cards) if (moving.has(card.id)) byId.set(card.id, card);
  const cards = ids.map((id) => byId.get(id)).filter((c): c is BoardCard => !!c);

  return columns.map((column) => {
    const touched = column.status === status || column.cards.some((c) => moving.has(c.id));
    if (!touched) return column;
    const rest = column.cards.filter((c) => !moving.has(c.id));
    if (column.status !== status) return { ...column, cards: rest };
    let at = rest.length;
    if (anchor.beforeId) {
      const i = rest.findIndex((c) => c.id === anchor.beforeId);
      if (i >= 0) at = i;
    } else if (anchor.afterId) {
      const i = rest.findIndex((c) => c.id === anchor.afterId);
      if (i >= 0) at = i + 1;
    }
    return { ...column, cards: [...rest.slice(0, at), ...cards, ...rest.slice(at)] };
  });
}

/// The selected cards in board order (column by column, top to bottom), so a block keeps its visual order.
export function inBoardOrder(columns: readonly BoardColumn[], ids: ReadonlySet<string>): string[] {
  const result: string[] = [];
  for (const column of columns)
    for (const card of column.cards) if (ids.has(card.id)) result.push(card.id);
  return result;
}

export function statusOf(columns: readonly BoardColumn[], cardId: string): TicketStatus | null {
  return columns.find((c) => c.cards.some((card) => card.id === cardId))?.status ?? null;
}

export function filtersFromParams(
  params: Readonly<Record<string, string | string[] | undefined>>,
): BoardFilters {
  const list = (name: string): string[] => {
    const value = params[name];
    if (value === undefined) return [];
    return (Array.isArray(value) ? value : value.split(',')).filter(Boolean);
  };
  return {
    assignees: list('assignee'),
    types: list('type') as TicketType[],
    labels: list('label'),
    projects: list('project'),
    mine: params['mine'] === '1' || params['mine'] === 'true',
    text: typeof params['q'] === 'string' ? params['q'] : '',
  };
}

export function filtersToParams(filters: BoardFilters): Record<string, string | null> {
  const join = (values: readonly string[]): string | null =>
    values.length ? values.join(',') : null;
  return {
    assignee: join(filters.assignees),
    type: join(filters.types),
    label: join(filters.labels),
    project: join(filters.projects),
    mine: filters.mine ? '1' : null,
    q: filters.text.trim() || null,
  };
}

function emptyCells(): Record<TicketStatus, BoardCard[]> {
  return Object.fromEntries(TICKET_STATUSES.map((s) => [s, []])) as unknown as Record<
    TicketStatus,
    BoardCard[]
  >;
}

function compareKeys(a: string, b: string): number {
  const [pa, na] = splitKey(a);
  const [pb, nb] = splitKey(b);
  return pa === pb ? na - nb : pa.localeCompare(pb);
}

function splitKey(key: string): [string, number] {
  const i = key.lastIndexOf('-');
  return [key.slice(0, i), Number(key.slice(i + 1))];
}
