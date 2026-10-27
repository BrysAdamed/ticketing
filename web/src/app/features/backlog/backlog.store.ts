import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { FieldHints } from '@core/tickets/field-hints';
import { TicketCache } from '@core/tickets/ticket-cache';
import { TicketEvents } from '@core/tickets/ticket-events';
import {
  Backlog,
  BacklogItem,
  BacklogParent,
  NewTicket,
  Ticket,
  TicketPatch,
  TicketSummary,
  UserRef,
} from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { TicketStatus, TicketType } from '@shared/domain/enums';
import {
  BacklogFilters,
  BacklogRow,
  buildRows,
  EMPTY_FILTERS,
  GroupBy,
  GroupRow,
  matchesFilters,
  moveBlock,
  planDrop,
  sortItems,
  SortBy,
} from './backlog-logic';
import {
  EMPTY_SELECTION,
  prune,
  select,
  SelectionState,
  SelectMode,
  step,
  targets,
} from './backlog-selection';

export interface CreateRow {
  kind: 'create';
  id: string;
  groupId: string;
  value: string | null;
}

export type ListRow = BacklogRow | CreateRow;

/// State of the project backlog (spec 6.4, layout-and-screens §3.2): one lean load, then everything
/// (grouping, selection, edits, drag reorder) is local and optimistic with rollback on failure.
@Injectable()
export class BacklogStore {
  private readonly api = inject(TicketsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly cache = inject(TicketCache);
  private readonly hints = inject(FieldHints);
  private readonly events = inject(TicketEvents);

  readonly projectKey = signal('');
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly canWrite = signal(false);
  readonly truncated = signal(false);
  readonly items = signal<readonly BacklogItem[]>([]);
  readonly users = signal<ReadonlyMap<string, UserRef>>(new Map());
  readonly parents = signal<ReadonlyMap<string, BacklogParent>>(new Map());

  readonly filters = signal<BacklogFilters>(EMPTY_FILTERS);
  readonly groupBy = signal<GroupBy>('status');
  readonly sortBy = signal<SortBy>('rank');
  readonly collapsed = signal<ReadonlySet<string>>(new Set(['status:Done']));
  readonly selection = signal<SelectionState>(EMPTY_SELECTION);
  readonly focusId = signal<string | null>(null);
  /// Group id (or 'all') where the quick-create row is open, null when closed.
  readonly creatingIn = signal<string | null>(null);
  readonly lastCreatedId = signal<string | null>(null);

  readonly hasData = computed(() => this.status() === 'loaded' || this.items().length > 0);
  readonly meId = computed(() => this.auth.currentUser()?.id ?? null);
  readonly visibleItems = computed(() => {
    const filters = this.filters();
    const me = this.meId();
    return sortItems(
      this.items().filter((item) => matchesFilters(item, filters, me)),
      this.sortBy(),
    );
  });
  readonly totalCount = computed(() => this.visibleItems().length);
  readonly rows = computed<ListRow[]>(() => {
    const rows: ListRow[] = buildRows(this.visibleItems(), this.groupBy(), {
      users: this.users(),
      parents: this.parents(),
      collapsed: this.collapsed(),
      showEmpty: false,
      keepGroup: this.creatingIn(),
    });
    const creating = this.creatingIn();
    if (creating === null) return rows;
    if (creating === 'all')
      return [{ kind: 'create', id: 'create:all', groupId: 'all', value: null }, ...rows];
    const index = rows.findIndex((r) => r.kind === 'group' && r.id === creating);
    if (index < 0) return rows;
    const group = rows[index] as GroupRow;
    return [
      ...rows.slice(0, index + 1),
      { kind: 'create', id: `create:${creating}`, groupId: creating, value: group.value },
      ...rows.slice(index + 1),
    ];
  });
  readonly order = computed(() =>
    this.rows()
      .filter((r) => r.kind === 'ticket')
      .map((r) => r.id),
  );
  readonly selectedIds = computed(() =>
    this.order().filter((id) => this.selection().selected.has(id)),
  );
  readonly canDrag = computed(() => this.canWrite() && this.sortBy() === 'rank');

  private loadToken = 0;

  constructor() {
    this.events.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
      if (event.kind === 'updated') this.applyServerTicket(event.ticket);
      else if (event.kind === 'deleted') this.removeLocal([event.key]);
      else if (event.kind === 'created' && event.ticket.projectKey === this.projectKey())
        this.addCreated(event.ticket, null);
    });
  }

  async load(projectKey: string): Promise<void> {
    const key = projectKey.toUpperCase();
    if (key !== this.projectKey()) {
      this.items.set([]);
      this.selection.set(EMPTY_SELECTION);
      this.focusId.set(null);
      this.creatingIn.set(null);
    }
    this.projectKey.set(key);
    const token = ++this.loadToken;
    this.status.set(this.items().length ? 'loaded' : 'loading');
    try {
      const filters = this.filters();
      const backlog = await firstValueFrom(
        this.api.backlog(key, {
          showDone: filters.showDone,
          type: filters.types,
          status: filters.statuses,
          priority: filters.priorities,
          assignee: filters.assignee,
          label: filters.labels,
          version: filters.version,
          text: filters.text.trim() || null,
        }),
      );
      if (token !== this.loadToken) return;
      this.apply(backlog);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (token !== this.loadToken) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  reload(): Promise<void> {
    return this.load(this.projectKey());
  }

  setFilters(filters: BacklogFilters): void {
    this.filters.set(filters);
    void this.reload();
  }

  toggleGroup(groupId: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Selection and keyboard focus

  click(id: string, mode: SelectMode): void {
    this.selection.update((state) => select(state, this.order(), id, mode));
    this.focusId.set(id);
  }

  clearSelection(): void {
    this.selection.set(EMPTY_SELECTION);
  }

  selectAll(): void {
    const order = this.order();
    this.selection.set({ selected: new Set(order), anchor: order[0] ?? null });
  }

  move(delta: 1 | -1, extend = false): string | null {
    const next = step(this.order(), this.focusId(), delta);
    const focus = this.focusId();
    if (next && extend) {
      const state = this.selection().anchor
        ? this.selection()
        : { selected: new Set(focus ? [focus] : []), anchor: focus };
      this.selection.set(select(state, this.order(), next, 'range'));
    }
    this.focusId.set(next);
    return next;
  }

  /// The tickets a keyboard or bulk action applies to: the selection when the focused row is in it.
  targets(focusId = this.focusId()): string[] {
    return targets(this.selection(), this.order(), focusId);
  }

  item(id: string): BacklogItem | undefined {
    return this.items().find((i) => i.id === id);
  }

  // Edits

  /// Applies a field change to several tickets: optimistic, one PATCH per ticket, rollback per failure.
  async update(
    ids: readonly string[],
    patch: TicketPatch,
    local: (item: BacklogItem) => Partial<BacklogItem>,
  ): Promise<void> {
    const before = new Map(
      ids.map((id) => [id, this.item(id)]).filter((e): e is [string, BacklogItem] => !!e[1]),
    );
    if (before.size === 0) return;
    this.items.update((items) =>
      items.map((item) => (before.has(item.id) ? { ...item, ...local(item) } : item)),
    );
    const results = await Promise.allSettled(
      [...before.values()].map(async (item) => {
        const ticket = await firstValueFrom(this.api.update(item.key, patch));
        this.cache.merge(ticket.key, ticket);
        this.events.emit({ kind: 'updated', ticket });
        return ticket;
      }),
    );
    const failed = [...before.values()].filter((_, i) => results[i].status === 'rejected');
    if (patch.labels || patch.addLabels || patch.version !== undefined)
      this.hints.invalidate(this.projectKey());
    if (failed.length === 0) return;
    const failedIds = new Set(failed.map((i) => i.id));
    this.items.update((items) =>
      items.map((item) => (failedIds.has(item.id) ? (before.get(item.id) ?? item) : item)),
    );
    const reason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
    this.toast.error(
      failed.length === 1
        ? `${failed[0].key}: ${toApiError(reason).title}`
        : `${failed.length} tickets were not updated: ${toApiError(reason).title}`,
      { action: { label: 'Retry', run: () => void this.update([...failedIds], patch, local) } },
    );
  }

  setStatus(ids: readonly string[], status: TicketStatus): Promise<void> {
    return this.update(ids, { status }, () => ({ status }));
  }

  setPriority(ids: readonly string[], priority: BacklogItem['priority']): Promise<void> {
    return this.update(ids, { priority }, () => ({ priority }));
  }

  setType(ids: readonly string[], type: TicketType): Promise<void> {
    return this.update(ids, { type }, () => ({ type }));
  }

  setPoints(ids: readonly string[], storyPoints: number | null): Promise<void> {
    return this.update(ids, { storyPoints }, () => ({ storyPoints }));
  }

  setAssignee(ids: readonly string[], user: UserRef | null): Promise<void> {
    if (user) this.users.update((map) => new Map(map).set(user.id, user));
    return this.update(ids, { assignee: user?.id ?? null }, () => ({
      assigneeId: user?.id ?? null,
    }));
  }

  assignToMe(ids: readonly string[]): Promise<void> {
    const me = this.auth.currentUser();
    if (!me) return Promise.resolve();
    return this.setAssignee(ids, {
      id: me.id,
      email: me.email,
      displayName: me.displayName,
      isActive: true,
    });
  }

  toggleLabel(ids: readonly string[], label: string, add: boolean): Promise<void> {
    const value = label.trim().toLowerCase();
    return this.update(ids, add ? { addLabels: [value] } : { removeLabels: [value] }, (item) => ({
      labels: add
        ? [...new Set([...item.labels, value])].sort()
        : item.labels.filter((l) => l !== value),
    }));
  }

  async remove(ids: readonly string[]): Promise<void> {
    const removed = ids.map((id) => this.item(id)).filter((i): i is BacklogItem => !!i);
    const snapshot = this.items();
    this.items.update((items) => items.filter((i) => !ids.includes(i.id)));
    this.clearSelection();
    const results = await Promise.allSettled(
      removed.map((item) => firstValueFrom(this.api.delete(item.key))),
    );
    const failed = removed.filter((_, i) => results[i].status === 'rejected');
    for (const item of removed.filter((i) => !failed.includes(i))) {
      this.cache.evict(item.key);
      this.events.emit({ kind: 'deleted', key: item.key });
    }
    if (failed.length) {
      const keep = new Set(failed.map((i) => i.id));
      const present = new Set(this.items().map((i) => i.id));
      this.items.set(snapshot.filter((i) => keep.has(i.id) || present.has(i.id)));
      const reason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
      this.toast.error(
        `${failed.map((i) => i.key).join(', ')} not deleted: ${toApiError(reason).title}`,
      );
    } else {
      this.toast.success(
        removed.length === 1 ? `${removed[0].key} deleted` : `${removed.length} tickets deleted`,
      );
    }
  }

  // Ranking

  /// Moves tickets dropped at `targetIndex` of the rows: changes the grouped field when they land in
  /// another group, then reorders them as one block before/after their new neighbour.
  async drop(ids: readonly string[], targetIndex: number): Promise<void> {
    const rows = this.rows();
    const groupId = this.groupAt(rows, targetIndex);
    const group = rows.find((r): r is GroupRow => r.kind === 'group' && r.id === groupId);
    const moving = new Set(ids);
    const fieldChanges = group ? ids.filter((id) => this.groupOf(id) !== groupId) : [];
    if (group && fieldChanges.length) await this.changeGroupField(fieldChanges, group);
    const plan = planDrop(this.rows(), moving, targetIndex, groupId);
    if (!plan || this.sortBy() !== 'rank') return;
    await this.rank(ids, plan.anchor, plan.local);
  }

  async rank(
    ids: readonly string[],
    anchor: { beforeKey?: string; afterKey?: string; position?: 'Top' | 'Bottom' },
    local: { beforeId?: string; afterId?: string; position?: 'Top' | 'Bottom' },
  ): Promise<void> {
    const snapshot = this.items();
    const ordered = this.items()
      .filter((i) => ids.includes(i.id))
      .map((i) => i.id);
    const block =
      this.sortBy() === 'rank' ? this.order().filter((id) => ids.includes(id)) : ordered;
    this.items.set(moveBlock(snapshot, block, local));
    try {
      await firstValueFrom(
        this.api.move({
          keys: block.map((id) => this.item(id)!.key),
          target: 'backlog',
          from: 'backlog',
          ...anchor,
        }),
      );
    } catch (error) {
      this.items.set(snapshot);
      this.toast.error(`Couldn't reorder: ${toApiError(error).title}`, {
        action: { label: 'Retry', run: () => void this.rank(ids, anchor, local) },
      });
    }
  }

  moveToEdge(ids: readonly string[], position: 'Top' | 'Bottom'): Promise<void> {
    return this.rank(ids, { position }, { position });
  }

  // Quick create

  openCreate(groupId: string | null): void {
    const target =
      groupId ??
      (this.groupBy() === 'none'
        ? 'all'
        : this.groupBy() === 'status'
          ? 'status:ToDo'
          : (this.groupOf(this.focusId()) ?? this.firstGroupId()));
    if (target !== 'all')
      this.collapsed.update((set) => new Set([...set].filter((g) => g !== target)));
    this.creatingIn.set(target);
  }

  closeCreate(): void {
    this.creatingIn.set(null);
  }

  /// Creates a ticket in the quick-create group and places it at the top of that group.
  async quickCreate(
    title: string,
    type: TicketType,
    row: CreateRow,
  ): Promise<TicketSummary | null> {
    const body: NewTicket = { title: title.trim(), type };
    const groupBy = this.groupBy();
    if (row.value !== null) {
      if (groupBy === 'status') body.status = row.value as TicketStatus;
      if (groupBy === 'type') body.type = row.value as TicketType;
      if (groupBy === 'assignee') body.assignee = row.value;
      if (groupBy === 'epic') body.parentKey = row.value;
    }
    const firstInGroup = this.rows().find(
      (r) => r.kind === 'ticket' && (row.groupId === 'all' || r.groupId === row.groupId),
    );
    try {
      const created = await firstValueFrom(
        this.api.create(this.projectKey(), body, crypto.randomUUID()),
      );
      this.addCreated(created, firstInGroup?.kind === 'ticket' ? firstInGroup.id : null);
      this.lastCreatedId.set(created.id);
      this.events.emit({ kind: 'created', ticket: created });
      if (firstInGroup?.kind === 'ticket' && this.sortBy() === 'rank') {
        void firstValueFrom(
          this.api.move({
            keys: [created.key],
            target: 'backlog',
            from: 'backlog',
            beforeKey: firstInGroup.item.key,
          }),
        ).catch(() => undefined);
      }
      return created;
    } catch (error) {
      this.toast.error(`Couldn't create the ticket: ${toApiError(error).title}`);
      return null;
    }
  }

  private addCreated(summary: TicketSummary, beforeId: string | null): void {
    if (this.items().some((i) => i.id === summary.id) || summary.location.kind !== 'Backlog')
      return;
    if (summary.assignee)
      this.users.update((map) => new Map(map).set(summary.assignee!.id, summary.assignee!));
    const item: BacklogItem = {
      id: summary.id,
      key: summary.key,
      title: summary.title,
      type: summary.type,
      status: summary.status,
      priority: summary.priority,
      severity: summary.severity,
      storyPoints: summary.storyPoints,
      version: summary.version,
      labels: summary.labels,
      assigneeId: summary.assignee?.id ?? null,
      parentId: summary.parentKey
        ? (this.items().find((i) => i.key === summary.parentKey)?.id ??
          [...this.parents().values()].find((p) => p.key === summary.parentKey)?.id ??
          null)
        : null,
      updatedAt: summary.updatedAt,
      childCount: 0,
      childDoneCount: 0,
      commentCount: 0,
      testCaseCount: 0,
    };
    this.items.update((items) =>
      moveBlock([...items, item], [item.id], beforeId ? { beforeId } : { position: 'Bottom' }),
    );
  }

  private applyServerTicket(ticket: Ticket): void {
    if (ticket.projectKey !== this.projectKey()) return;
    if (ticket.location.kind !== 'Backlog') {
      this.removeLocal([ticket.key]);
      return;
    }
    if (ticket.assignee)
      this.users.update((map) => new Map(map).set(ticket.assignee!.id, ticket.assignee!));
    if (ticket.parent) {
      const parent = ticket.parent;
      this.parents.update((map) =>
        new Map(map).set(parent.id, {
          id: parent.id,
          key: parent.key,
          title: parent.title,
          type: parent.type,
        }),
      );
    }
    this.items.update((items) =>
      items.map((item) =>
        item.id === ticket.id
          ? {
              ...item,
              title: ticket.title,
              type: ticket.type,
              status: ticket.status,
              priority: ticket.priority,
              severity: ticket.severity,
              storyPoints: ticket.storyPoints,
              version: ticket.version,
              labels: ticket.labels,
              assigneeId: ticket.assignee?.id ?? null,
              parentId: ticket.parent?.id ?? null,
              updatedAt: ticket.updatedAt,
              commentCount: ticket.commentCount ?? item.commentCount,
            }
          : item,
      ),
    );
  }

  private removeLocal(keys: readonly string[]): void {
    this.items.update((items) => items.filter((i) => !keys.includes(i.key)));
  }

  private apply(backlog: Backlog): void {
    this.canWrite.set(backlog.canWrite);
    this.truncated.set(backlog.truncated);
    this.users.set(new Map(backlog.users.map((u) => [u.id, u])));
    this.parents.set(new Map(backlog.parents.map((p) => [p.id, p])));
    this.items.set(backlog.items);
    this.selection.update((state) =>
      prune(
        state,
        backlog.items.map((i) => i.id),
      ),
    );
  }

  private async changeGroupField(ids: readonly string[], group: GroupRow): Promise<void> {
    switch (this.groupBy()) {
      case 'status':
        return this.setStatus(ids, group.value as TicketStatus);
      case 'type':
        return this.setType(ids, group.value as TicketType);
      case 'assignee':
        return this.setAssignee(ids, group.value ? (this.users().get(group.value) ?? null) : null);
      case 'epic': {
        const parent = group.value
          ? [...this.parents().values()].find((p) => p.key === group.value)
          : null;
        return this.update(ids, { parentKey: group.value }, () => ({
          parentId: parent?.id ?? null,
        }));
      }
    }
  }

  private groupAt(rows: readonly ListRow[], index: number): string {
    for (let i = Math.min(index, rows.length - 1); i >= 0; i--) {
      const row = rows[i];
      if (row.kind === 'group') return row.id;
      if (row.kind === 'ticket' || row.kind === 'create') return row.groupId;
    }
    return 'all';
  }

  private groupOf(id: string | null): string | null {
    if (!id) return null;
    const row = this.rows().find((r) => r.kind === 'ticket' && r.id === id);
    return row && row.kind === 'ticket' ? row.groupId : null;
  }

  private firstGroupId(): string {
    const group = this.rows().find((r) => r.kind === 'group');
    return group?.id ?? (this.groupBy() === 'status' ? 'status:ToDo' : 'all');
  }
}
