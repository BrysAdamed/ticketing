import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { BoardDirectory } from '@core/boards/board-directory';
import {
  ArchiveBoardResult,
  Board,
  BoardCard,
  BoardColumn,
  BoardPatch,
  CarryOverTarget,
} from '@core/boards/board.models';
import { BoardsApi } from '@core/boards/boards.api';
import { ToastService } from '@core/notify/toast.service';
import type { TourAccess } from '@core/onboarding/engine/tour.model';
import { LoadStatus } from '@core/projects/project-directory';
import { MoveChildren } from '@core/tickets/move-children';
import { TicketEvents } from '@core/tickets/ticket-events';
import { TicketsApi } from '@core/tickets/tickets.api';
import { Ticket, TicketPatch, UserRef } from '@core/tickets/ticket.models';
import { Priority, TICKET_STATUSES, TicketStatus } from '@shared/domain/enums';
import {
  applyMove,
  buildLanes,
  EMPTY_FILTERS,
  BoardFilters,
  inBoardOrder,
  MoveAnchor,
  statusOf,
  Swimlanes,
} from './board-logic';

const COLLAPSED_KEY = 'tk-board-collapsed';

/// State of one board page: the board as loaded (columns in board order), quick filters, swimlanes,
/// selection and focus, plus optimistic moves with rollback (spec 10).
@Injectable()
export class BoardStore {
  private readonly api = inject(BoardsApi);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly directory = inject(BoardDirectory);
  private readonly events = inject(TicketEvents);
  private readonly moveChildren = inject(MoveChildren);

  readonly boardId = signal<string | null>(null);
  readonly board = signal<Board | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  readonly filters = signal<BoardFilters>(EMPTY_FILTERS);
  readonly swimlanes = signal<Swimlanes>('none');
  readonly selection = signal<ReadonlySet<string>>(new Set());
  readonly focusId = signal<string | null>(null);
  readonly collapsed = signal<ReadonlySet<TicketStatus>>(new Set());
  readonly moving = signal(false);

  readonly meId = computed(() => this.auth.currentUser()?.id ?? null);
  readonly isArchived = computed(() => !!this.board()?.archivedAt);
  readonly canManage = computed(() => !!this.board()?.permissions.canManage);
  readonly writableProjects = computed(
    () => new Set((this.board()?.projects ?? []).filter((p) => p.canWrite).map((p) => p.key)),
  );
  readonly canAddTickets = computed(() => !this.isArchived() && this.writableProjects().size > 0);
  /// What the board tour may show (D-136): writing is placing cards, `owner` is managing the board.
  readonly tourAccess = computed<TourAccess | null>(() => {
    const board = this.board();
    return board
      ? {
          canWrite: this.canAddTickets(),
          isOwner: board.permissions.canManage,
          isAdmin: this.auth.isAdmin(),
        }
      : null;
  });
  readonly users = computed(() => new Map((this.board()?.users ?? []).map((u) => [u.id, u])));
  readonly parents = computed(() => new Map((this.board()?.parents ?? []).map((p) => [p.id, p])));
  readonly columns = computed<readonly BoardColumn[]>(() => this.board()?.columns ?? []);
  readonly lanes = computed(() => {
    const board = this.board();
    return board ? buildLanes(board, this.filters(), this.swimlanes(), this.meId()) : [];
  });
  readonly visibleCount = computed(() => this.lanes().reduce((sum, lane) => sum + lane.count, 0));
  readonly totalCount = computed(() => this.columns().reduce((sum, c) => sum + c.cards.length, 0));
  readonly totalPoints = computed(() =>
    this.columns().reduce(
      (sum, c) => sum + c.cards.reduce((s, card) => s + (card.storyPoints ?? 0), 0),
      0,
    ),
  );
  readonly columnCounts = computed(() => {
    const counts = new Map<TicketStatus, number>();
    for (const lane of this.lanes())
      for (const status of TICKET_STATUSES)
        counts.set(status, (counts.get(status) ?? 0) + lane.cells[status].length);
    return counts;
  });
  readonly labelOptions = computed(() =>
    [...new Set(this.columns().flatMap((c) => c.cards.flatMap((card) => card.labels)))].sort(),
  );
  /// Cards in visual order (lane by lane, column by column), for J/K/H/L navigation.
  readonly visualOrder = computed(() => {
    const result: { id: string; status: TicketStatus; lane: string }[] = [];
    for (const lane of this.lanes())
      for (const status of TICKET_STATUSES)
        for (const card of lane.cells[status]) result.push({ id: card.id, status, lane: lane.key });
    return result;
  });

  private loadToken = 0;
  private moveSeq = 0;

  constructor() {
    this.events.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
      if (event.kind === 'updated') this.applyTicket(event.ticket);
      else if (event.kind === 'deleted') this.removeCards((card) => card.key === event.key);
      else if (
        (event.kind === 'created' || event.kind === 'restored') &&
        event.ticket.location.boardId === this.boardId()
      )
        void this.reload(true);
    });
  }

  async load(boardId: string): Promise<void> {
    if (boardId !== this.boardId()) {
      this.board.set(null);
      this.selection.set(new Set());
      this.focusId.set(null);
      this.collapsed.set(readCollapsed(boardId));
    }
    this.boardId.set(boardId);
    await this.reload();
  }

  async reload(silent = false): Promise<void> {
    const id = this.boardId();
    if (!id) return;
    const token = ++this.loadToken;
    if (!silent) this.status.set(this.board() ? 'loaded' : 'loading');
    try {
      const board = await firstValueFrom(this.api.get(id));
      if (token !== this.loadToken) return;
      this.setBoard(board);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (token !== this.loadToken) return;
      const apiError = toApiError(error);
      if (apiError.isNotFound) this.directory.forget(id);
      this.error.set(apiError);
      this.status.set('error');
    }
  }

  canDrag(card: BoardCard): boolean {
    return !this.isArchived() && this.writableProjects().has(card.projectKey);
  }

  /// The cards a drag of `cardId` moves: the whole selection when the card is part of it.
  movingIds(cardId: string): string[] {
    const selection = this.selection();
    if (!selection.has(cardId)) return [cardId];
    const ids = inBoardOrder(this.columns(), selection);
    const columns = this.columns();
    return ids.filter((id) => {
      const card = findCard(columns, id);
      return !!card && this.canDrag(card);
    });
  }

  /// Moves cards optimistically, then confirms with one `POST /tickets/move`. On failure the board
  /// rolls back (or reloads when another move happened in between) and the error is shown.
  async move(ids: readonly string[], status: TicketStatus, anchor: MoveAnchor): Promise<boolean> {
    const board = this.board();
    if (!board || ids.length === 0) return false;
    const before = board.columns;
    const keys = ids.map((id) => findCard(before, id)?.key).filter((k): k is string => !!k);
    const beforeKey = anchor.beforeId ? findCard(before, anchor.beforeId)?.key : undefined;
    const afterKey = anchor.afterId ? findCard(before, anchor.afterId)?.key : undefined;
    const parentProgressChanges = ids.some((id) => {
      const parentId = findCard(before, id)?.parentId;
      return (
        !!parentId &&
        !!findCard(before, parentId) &&
        (statusOf(before, id) === 'Done') !== (status === 'Done')
      );
    });
    const seq = ++this.moveSeq;
    this.board.set({ ...board, columns: applyMove(before, ids, status, anchor) });
    this.moving.set(true);
    try {
      await firstValueFrom(
        this.ticketsApi.move({
          keys,
          target: board.id,
          from: board.id,
          status,
          beforeKey,
          afterKey,
        }),
      );
      if (parentProgressChanges) void this.reload(true);
      return true;
    } catch (error) {
      if (seq === this.moveSeq && this.board())
        this.board.set({ ...this.board()!, columns: before });
      else void this.reload(true);
      this.toast.error(
        `Couldn't move ${keys.length === 1 ? keys[0] : `${keys.length} tickets`}: ${toApiError(error).title}`,
      );
      return false;
    } finally {
      if (seq === this.moveSeq) this.moving.set(false);
    }
  }

  /// Keyboard move (Shift+H / Shift+L): the focused card or the selection goes to the previous or next column.
  async shiftStatus(delta: 1 | -1): Promise<void> {
    const focus = this.focusId();
    if (!focus) return;
    const current = statusOf(this.columns(), focus);
    if (!current) return;
    const next = TICKET_STATUSES[TICKET_STATUSES.indexOf(current) + delta];
    if (!next) return;
    const ids = this.movingIds(focus);
    if (ids.length) await this.move(ids, next, {});
  }

  /// The cards a keyboard edit (`s`, `p`, `i`) applies to: the editable selection, else the focused card.
  editTargets(): string[] {
    const selection = this.selection();
    const ids = selection.size ? inBoardOrder(this.columns(), selection) : [this.focusId() ?? ''];
    const columns = this.columns();
    return ids.filter((id) => {
      const card = findCard(columns, id);
      return !!card && this.canDrag(card);
    });
  }

  setPriority(ids: readonly string[], priority: Priority): Promise<boolean> {
    return this.patchCards(ids, { priority }, { priority });
  }

  /// `I`: assigns the cards to the current user, with an Undo that puts back each previous assignee.
  async assignToMe(ids: readonly string[]): Promise<void> {
    const user = this.auth.currentUser();
    const board = this.board();
    if (!user || !board) return;
    const cards = ids
      .map((id) => findCard(board.columns, id))
      .filter((c): c is BoardCard => !!c && c.assigneeId !== user.id);
    if (cards.length === 0) return;
    const me: UserRef = {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      isActive: true,
    };
    const previous = new Map(cards.map((c) => [c.id, c.assigneeId]));
    if (!(await this.setAssignee([...previous.keys()], me))) return;
    this.toast.success(
      cards.length === 1
        ? `${cards[0].key} assigned to you`
        : `${cards.length} tickets assigned to you`,
      { action: { label: 'Undo', run: () => void this.restoreAssignees(previous) } },
    );
  }

  setAssignee(ids: readonly string[], user: UserRef | null): Promise<boolean> {
    const board = this.board();
    if (board && user && !board.users.some((u) => u.id === user.id))
      this.board.set({ ...board, users: [...board.users, user] });
    return this.patchCards(ids, { assignee: user?.id ?? null }, { assigneeId: user?.id ?? null });
  }

  private async restoreAssignees(previous: ReadonlyMap<string, string | null>): Promise<void> {
    const byAssignee = new Map<string | null, string[]>();
    for (const [id, assigneeId] of previous)
      byAssignee.set(assigneeId, [...(byAssignee.get(assigneeId) ?? []), id]);
    const users = this.users();
    await Promise.all(
      [...byAssignee].map(([assigneeId, ids]) =>
        this.setAssignee(ids, assigneeId ? (users.get(assigneeId) ?? null) : null),
      ),
    );
  }

  /// Optimistic field edit of several cards: one PATCH per ticket, rollback of the cards that failed.
  /// Resolves true when every ticket was updated.
  private async patchCards(
    ids: readonly string[],
    patch: TicketPatch,
    local: Partial<BoardCard>,
  ): Promise<boolean> {
    const board = this.board();
    if (!board || ids.length === 0) return false;
    const before = new Map(
      ids
        .map((id) => [id, findCard(board.columns, id)])
        .filter((e): e is [string, BoardCard] => !!e[1]),
    );
    this.replaceCards((card) => (before.has(card.id) ? { ...card, ...local } : card));
    const cards = [...before.values()];
    const results = await Promise.allSettled(
      cards.map(async (card) => {
        const ticket = await firstValueFrom(this.ticketsApi.update(card.key, patch));
        this.events.emit({ kind: 'updated', ticket });
      }),
    );
    const failed = cards.filter((_, i) => results[i].status === 'rejected');
    if (failed.length === 0) return true;
    const failedIds = new Set(failed.map((c) => c.id));
    this.replaceCards((card) => (failedIds.has(card.id) ? (before.get(card.id) ?? card) : card));
    const reason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    this.toast.error(
      failed.length === 1
        ? `${failed[0].key}: ${toApiError(reason).title}`
        : `${failed.length} tickets were not updated: ${toApiError(reason).title}`,
    );
    return false;
  }

  private replaceCards(map: (card: BoardCard) => BoardCard): void {
    const board = this.board();
    if (!board) return;
    this.board.set({
      ...board,
      columns: board.columns.map((c) => ({ ...c, cards: c.cards.map(map) })),
    });
  }

  /// Asks whether sub-tickets on this board come along (TKT-71), then the cards (and those
  /// sub-tickets) leave the board at once and come back if the move fails.
  async sendToBacklog(ids: readonly string[]): Promise<void> {
    const board = this.board();
    if (!board || ids.length === 0) return;
    const cards = ids.map((id) => findCard(board.columns, id)).filter((c): c is BoardCard => !!c);
    const keys = cards.map((c) => c.key);
    if (keys.length === 0) return;
    const decision = await this.moveChildren.ask({
      keys,
      from: board.id,
      childCounts: cards.map((c) => c.childCount),
      source: { kind: 'board' },
      destination: { kind: 'backlog' },
    });
    if (!decision) return;
    const current = this.board();
    if (!current) return;
    const before = current.columns;
    const moving = new Set(ids);
    const childKeys = new Set(decision.childKeys);
    this.board.set({
      ...current,
      columns: before.map((c) => ({
        ...c,
        cards: c.cards.filter((card) => !moving.has(card.id) && !childKeys.has(card.key)),
      })),
    });
    this.selection.set(new Set());
    try {
      const moved = await firstValueFrom(
        this.ticketsApi.move({
          keys,
          target: 'backlog',
          from: board.id,
          ...(decision.includeChildren ? { includeChildren: true } : {}),
        }),
      );
      const children = Math.max(0, (moved?.length ?? keys.length) - keys.length);
      this.toast.success(
        (keys.length === 1
          ? `${keys[0]} moved to the backlog`
          : `${keys.length} tickets moved to their backlogs`) +
          (children > 0
            ? ` with ${children} ${children === 1 ? 'sub-ticket' : 'sub-tickets'}`
            : ''),
      );
      void this.reload(true);
    } catch (error) {
      this.board.set({ ...this.board()!, columns: before });
      this.toast.error(error);
    }
  }

  /// "Add tickets from backlog": asks whether sub-tickets in the backlog come along (TKT-71).
  /// Resolves false when the user cancelled or the move failed, so the dialog stays open.
  async addFromBacklog(keys: readonly string[], childCounts: readonly number[]): Promise<boolean> {
    const board = this.board();
    if (!board || keys.length === 0) return false;
    const decision = await this.moveChildren.ask({
      keys,
      from: 'backlog',
      childCounts,
      source: { kind: 'backlog' },
      destination: { kind: 'board', name: board.name },
    });
    if (!decision) return false;
    try {
      const moved = await firstValueFrom(
        this.ticketsApi.move({
          keys: [...keys],
          target: board.id,
          from: 'backlog',
          ...(decision.includeChildren ? { includeChildren: true } : {}),
        }),
      );
      const total = Math.max(moved?.length ?? 0, keys.length);
      this.toast.success(
        total === 1 ? `${keys[0]} added to the board` : `${total} tickets added to the board`,
      );
      await this.reload(true);
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
  }

  async update(patch: BoardPatch): Promise<boolean> {
    const board = this.board();
    if (!board) return false;
    try {
      const updated = await firstValueFrom(this.api.update(board.id, patch));
      this.setBoard(updated);
      void this.directory.reload();
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
  }

  async archive(carryOverTo: CarryOverTarget): Promise<ArchiveBoardResult | null> {
    const board = this.board();
    if (!board) return null;
    try {
      const result = await firstValueFrom(this.api.archive(board.id, carryOverTo));
      this.setBoard(result.board);
      this.selection.set(new Set());
      void this.directory.reload();
      return result;
    } catch (error) {
      this.toast.error(error);
      return null;
    }
  }

  async unarchive(): Promise<void> {
    const board = this.board();
    if (!board) return;
    try {
      this.setBoard(await firstValueFrom(this.api.unarchive(board.id)));
      void this.directory.reload();
      this.toast.success('Board unarchived');
    } catch (error) {
      this.toast.error(error);
    }
  }

  async delete(): Promise<boolean> {
    const board = this.board();
    if (!board) return false;
    try {
      await firstValueFrom(this.api.delete(board.id));
      this.directory.forget(board.id);
      void this.directory.reload();
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
  }

  toggleSelect(cardId: string): void {
    this.selection.update((set) => {
      const next = new Set(set);
      if (next.has(cardId)) next.delete(cardId);
      else next.add(cardId);
      return next;
    });
  }

  clearSelection(): void {
    this.selection.set(new Set());
  }

  toggleColumn(status: TicketStatus): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      writeCollapsed(this.boardId(), next);
      return next;
    });
  }

  /// Keyboard focus: J/K within the column, H/L to the neighbouring column (same lane).
  moveFocus(direction: 'up' | 'down' | 'left' | 'right'): string | null {
    const order = this.visualOrder();
    if (!order.length) return null;
    const current = order.find((c) => c.id === this.focusId());
    let next = order[0];
    if (current) {
      const sameCell = order.filter((c) => c.lane === current.lane && c.status === current.status);
      const index = sameCell.findIndex((c) => c.id === current.id);
      if (direction === 'down') next = sameCell[index + 1] ?? current;
      else if (direction === 'up') next = sameCell[index - 1] ?? current;
      else {
        const statuses = TICKET_STATUSES.filter((s) =>
          order.some((c) => c.lane === current.lane && c.status === s),
        );
        const target =
          statuses[statuses.indexOf(current.status) + (direction === 'right' ? 1 : -1)];
        const cell = target
          ? order.filter((c) => c.lane === current.lane && c.status === target)
          : [];
        next = cell[Math.min(index, cell.length - 1)] ?? current;
      }
    }
    this.focusId.set(next.id);
    return next.id;
  }

  cardById(id: string): BoardCard | undefined {
    return findCard(this.columns(), id);
  }

  private setBoard(board: Board): void {
    this.board.set(board);
    this.directory.visited({ id: board.id, name: board.name });
    const ids = new Set(board.columns.flatMap((c) => c.cards.map((card) => card.id)));
    if ([...this.selection()].some((id) => !ids.has(id)))
      this.selection.update((set) => new Set([...set].filter((id) => ids.has(id))));
  }

  /// Applies an edit made elsewhere (peek panel): fields change in place; a new status or location reloads
  /// silently so the card lands at its rank.
  private applyTicket(ticket: Ticket): void {
    const board = this.board();
    if (!board) return;
    const current = findCard(board.columns, ticket.id);
    if (!current) {
      if (ticket.location.boardId === board.id) void this.reload(true);
      return;
    }
    if (
      ticket.location.boardId !== board.id ||
      statusOf(board.columns, ticket.id) !== ticket.status
    ) {
      void this.reload(true);
      return;
    }
    const updated: BoardCard = {
      ...current,
      title: ticket.title,
      type: ticket.type,
      priority: ticket.priority,
      severity: ticket.severity,
      storyPoints: ticket.storyPoints,
      labels: ticket.labels,
      assigneeId: ticket.assignee?.id ?? null,
      parentId: ticket.parent?.id ?? null,
    };
    const users =
      ticket.assignee && !board.users.some((u) => u.id === ticket.assignee!.id)
        ? [...board.users, ticket.assignee]
        : board.users;
    const parentKnown = !ticket.parent || board.parents.some((p) => p.id === ticket.parent!.id);
    this.board.set({
      ...board,
      users,
      columns: board.columns.map((c) =>
        c.cards.includes(current)
          ? { ...c, cards: c.cards.map((card) => (card === current ? updated : card)) }
          : c,
      ),
    });
    if (!parentKnown) void this.reload(true);
  }

  private removeCards(predicate: (card: BoardCard) => boolean): void {
    const board = this.board();
    if (!board) return;
    this.board.set({
      ...board,
      columns: board.columns.map((c) => ({
        ...c,
        cards: c.cards.filter((card) => !predicate(card)),
      })),
    });
  }
}

function findCard(columns: readonly BoardColumn[], id: string): BoardCard | undefined {
  for (const column of columns) {
    const card = column.cards.find((c) => c.id === id);
    if (card) return card;
  }
  return undefined;
}

function readCollapsed(boardId: string): ReadonlySet<TicketStatus> {
  try {
    const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as Record<
      string,
      TicketStatus[]
    >;
    return new Set((all[boardId] ?? []).filter((s) => TICKET_STATUSES.includes(s)));
  } catch {
    return new Set();
  }
}

function writeCollapsed(boardId: string | null, collapsed: ReadonlySet<TicketStatus>): void {
  if (!boardId) return;
  try {
    const all = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '{}') as Record<
      string,
      TicketStatus[]
    >;
    all[boardId] = [...collapsed];
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify(all));
  } catch {
    // Storage unavailable: the layout is kept for this page view only.
  }
}
