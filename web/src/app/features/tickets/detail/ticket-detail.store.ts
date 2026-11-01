import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { FieldHints } from '@core/tickets/field-hints';
import { TicketCache } from '@core/tickets/ticket-cache';
import { TicketAttachments } from '@core/tickets/ticket-attachments';
import { MoveChildren } from '@core/tickets/move-children';
import { MoveTarget } from '@core/tickets/move-targets';
import { TicketDeletion } from '@core/tickets/ticket-deletion';
import { TicketEvents } from '@core/tickets/ticket-events';
import {
  ActivityEntry,
  Comment,
  NewTicket,
  Ticket,
  TicketPatch,
  TicketRef,
  UserRef,
  Watchers,
} from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { Page } from '@core/api/page';
import { TicketLinkType } from '@shared/domain/enums';
import { NO_WATCHERS, withoutWatcher, withWatcher } from '@core/watchers/watchers';

export type SaveResult = 'saved' | 'conflict' | 'failed';

const HISTORY_PAGE = 50;

/// A server copy of the same ticket saved after the one shown (D-165): another view's edit that
/// this view must take, or its next If-Match save fails with a stale row version.
const isNewer = (candidate: Ticket, current: Ticket): boolean =>
  candidate.rowVersion !== current.rowVersion &&
  Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt);

/// State of one open ticket (page or peek): cached data first, then fresh data; every edit is
/// optimistic with rollback. Title and description saves send If-Match (D-43) and report conflicts.
@Injectable()
export class TicketDetailStore {
  private readonly api = inject(TicketsApi);
  private readonly cache = inject(TicketCache);
  private readonly events = inject(TicketEvents);
  private readonly attachments = inject(TicketAttachments);
  private readonly toast = inject(ToastService);
  private readonly hints = inject(FieldHints);
  private readonly auth = inject(AuthService);
  private readonly deletion = inject(TicketDeletion);
  private readonly moveChildren = inject(MoveChildren);

  readonly key = signal('');
  readonly ticket = signal<Ticket | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  readonly comments = signal<readonly Comment[]>([]);
  readonly commentCount = signal(0);
  readonly allCommentsLoaded = computed(() => this.comments().length >= this.commentCount());

  readonly history = signal<readonly ActivityEntry[]>([]);
  readonly historyUsers = signal<ReadonlyMap<string, UserRef>>(new Map());
  readonly historyCursor = signal<string | null>(null);
  readonly historyStatus = signal<LoadStatus>('idle');

  readonly canEdit = computed(() => this.ticket()?.permissions.canEdit ?? false);
  readonly me = computed(() => this.auth.currentUser());

  private loadToken = 0;
  private watchToken = 0;

  constructor() {
    this.events.events.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((event) => {
      const current = this.ticket();
      if (!current || event.kind !== 'updated') return;
      if (event.ticket.id !== current.id) this.refreshRelated(event.ticket);
      else if (isNewer(event.ticket, current))
        this.ticket.set(this.mergeKeepingCollections(event.ticket));
      else if (event.ticket.watchers && event.ticket.watchers !== current.watchers)
        this.ticket.set({ ...current, watchers: event.ticket.watchers });
    });
    this.attachments.changes.pipe(takeUntilDestroyed(inject(DestroyRef))).subscribe((change) => {
      if (change.ticketKey === this.ticket()?.key.toUpperCase()) void this.refreshMeta();
    });
  }

  async load(key: string): Promise<void> {
    const normalized = key.toUpperCase();
    const token = ++this.loadToken;
    const switching = normalized !== this.key();
    this.key.set(normalized);
    if (switching) {
      this.history.set([]);
      this.historyCursor.set(null);
      this.historyStatus.set('idle');
      this.error.set(null);
      const cached = this.cache.peek(normalized);
      this.setTicket(cached);
      this.status.set(cached ? 'loaded' : 'loading');
      if (cached && this.cache.isFresh(normalized)) return;
    }
    try {
      const ticket = await this.cache.fetch(normalized);
      if (token !== this.loadToken) return;
      this.setTicket(ticket);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (token !== this.loadToken) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  async reload(): Promise<void> {
    this.cache.evict(this.key());
    const token = ++this.loadToken;
    try {
      const ticket = await this.cache.fetch(this.key());
      if (token !== this.loadToken) return;
      this.setTicket(ticket);
      this.status.set('loaded');
      if (this.historyStatus() !== 'idle') void this.loadHistory();
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  /// Applies `optimistic` locally, sends the PATCH and merges the response; rolls back on failure.
  async patch(
    patch: TicketPatch,
    optimistic: Partial<Ticket> = {},
    options: { ifMatch?: boolean; quiet?: boolean } = {},
  ): Promise<SaveResult> {
    const before = this.ticket();
    if (!before) return 'failed';
    this.ticket.set({ ...before, ...optimistic });
    try {
      const updated = await firstValueFrom(
        this.api.update(before.key, patch, options.ifMatch ? before.rowVersion : undefined),
      );
      this.applyServer(updated);
      if (patch.labels || patch.addLabels || patch.version !== undefined)
        this.hints.invalidate(before.projectKey);
      if (patch.assignee !== undefined && !updated.watchers) void this.refreshWatchers();
      if (this.historyStatus() !== 'idle') void this.loadHistory();
      return 'saved';
    } catch (error) {
      this.ticket.set(this.mergeKeepingCollections(before));
      const apiError = toApiError(error);
      if (apiError.isConflict && apiError.code === 'concurrency.conflict') return 'conflict';
      if (!options.quiet)
        this.toast.error(apiError.title, {
          action: { label: 'Retry', run: () => void this.patch(patch, optimistic, options) },
        });
      return 'failed';
    }
  }

  /// `i`: assigns the ticket to the signed-in user, with an Undo toast that puts the previous
  /// assignee back (D-81).
  async assignToMe(): Promise<void> {
    const me = this.me();
    const before = this.ticket();
    if (!me || !before || before.assignee?.id === me.id) return;
    const previous = before.assignee;
    const result = await this.patch(
      { assignee: me.id },
      { assignee: { id: me.id, email: me.email, displayName: me.displayName, isActive: true } },
    );
    if (result !== 'saved') return;
    this.toast.success(`${before.key} assigned to you`, {
      action: {
        label: 'Undo',
        run: () => void this.patch({ assignee: previous?.id ?? null }, { assignee: previous }),
      },
    });
  }

  /// Moves the ticket to its backlog (top) or a board (bottom of its status column), spec 6.4, after
  /// asking whether its sub-tickets in the place it leaves come along (TKT-71).
  async moveTo(target: MoveTarget, targetName?: string): Promise<void> {
    const ticket = this.ticket();
    if (!ticket) return;
    const from: MoveTarget =
      ticket.location.kind === 'Backlog' ? 'backlog' : (ticket.location.boardId ?? 'backlog');
    if (target === from) return;
    const decision = await this.moveChildren.ask({
      keys: [ticket.key],
      from,
      childCounts: [ticket.children?.length ?? ticket.childProgress?.total ?? 0],
      source:
        ticket.location.kind === 'Backlog'
          ? { kind: 'backlog' }
          : { kind: 'board', name: ticket.location.boardName ?? undefined },
      destination:
        target === 'backlog'
          ? { kind: 'backlog' }
          : { kind: 'board', name: targetName ?? 'the board' },
    });
    if (!decision) return;
    try {
      const moved = await firstValueFrom(
        this.api.move({
          keys: [ticket.key],
          target,
          from,
          ...(target === 'backlog' ? { position: 'Top' as const } : {}),
          ...(decision.includeChildren ? { includeChildren: true } : {}),
        }),
      );
      this.cache.evict(ticket.key);
      const children = (moved ?? []).filter((t) => t.key !== ticket.key);
      children.forEach((child) => this.cache.evict(child.key));
      const fresh = await this.cache.fetch(ticket.key);
      this.applyServer(fresh);
      const along = children.length
        ? ` with ${children.length} ${children.length === 1 ? 'sub-ticket' : 'sub-tickets'}`
        : '';
      this.toast.success(
        `${ticket.key} moved${along} to ${fresh.location.kind === 'Backlog' ? 'the backlog' : fresh.location.boardName}`,
      );
      if (this.historyStatus() !== 'idle') void this.loadHistory();
    } catch (error) {
      this.toast.error(`Couldn't move ${ticket.key}: ${toApiError(error).title}`);
    }
  }

  // Watchers

  /// `w`: watches or unwatches at once and rolls back with an error toast if the server refuses.
  /// Only the latest of several quick toggles applies its response.
  async toggleWatch(): Promise<void> {
    const ticket = this.ticket();
    const me = this.me();
    if (!ticket || !me) return;
    const before = ticket.watchers ?? NO_WATCHERS;
    const watch = !before.watching;
    const token = ++this.watchToken;
    this.setWatchers(
      ticket.id,
      watch
        ? withWatcher(before, {
            id: me.id,
            email: me.email,
            displayName: me.displayName,
            isActive: true,
          })
        : withoutWatcher(before, me.id),
    );
    try {
      const fresh = await firstValueFrom(
        watch ? this.api.watch(ticket.key) : this.api.unwatch(ticket.key),
      );
      if (token === this.watchToken) this.publishWatchers(ticket.id, fresh);
    } catch (error) {
      if (token === this.watchToken) this.setWatchers(ticket.id, before);
      this.toast.error(
        `Couldn't ${watch ? 'watch' : 'unwatch'} ${ticket.key}: ${toApiError(error).title}`,
      );
    }
  }

  // Comments

  async addComment(body: string): Promise<boolean> {
    const ticket = this.ticket();
    if (!ticket) return false;
    try {
      const comment = await firstValueFrom(this.api.addComment(ticket.key, body));
      this.comments.update((list) => [...list, comment]);
      this.commentCount.update((n) => n + 1);
      this.afterCommentChange();
      return true;
    } catch (error) {
      this.toast.error(`Couldn't add the comment: ${toApiError(error).title}`);
      return false;
    }
  }

  async editComment(id: string, body: string): Promise<boolean> {
    const before = this.comments();
    this.comments.update((list) => list.map((c) => (c.id === id ? { ...c, body } : c)));
    try {
      const comment = await firstValueFrom(this.api.editComment(id, body));
      this.comments.update((list) => list.map((c) => (c.id === id ? comment : c)));
      this.afterCommentChange();
      return true;
    } catch (error) {
      this.comments.set(before);
      this.toast.error(`Couldn't save the comment: ${toApiError(error).title}`);
      return false;
    }
  }

  async deleteComment(id: string): Promise<void> {
    const before = this.comments();
    this.comments.update((list) =>
      list.map((c) =>
        c.id === id ? { ...c, body: '', deleted: true, canEdit: false, canDelete: false } : c,
      ),
    );
    try {
      const comment = await firstValueFrom(this.api.deleteComment(id));
      this.comments.update((list) => list.map((c) => (c.id === id ? comment : c)));
      this.afterCommentChange();
    } catch (error) {
      this.comments.set(before);
      this.toast.error(`Couldn't delete the comment: ${toApiError(error).title}`);
    }
  }

  async loadAllComments(): Promise<void> {
    const ticket = this.ticket();
    if (!ticket) return;
    const all: Comment[] = [];
    let cursor: string | null = null;
    try {
      do {
        const page: Page<Comment> = await firstValueFrom(
          this.api.comments(ticket.key, { limit: 100, cursor }),
        );
        all.push(...page.items);
        cursor = page.nextCursor;
      } while (cursor);
      this.comments.set(all);
      this.commentCount.set(all.length);
    } catch (error) {
      this.toast.error(toApiError(error).title);
    }
  }

  // History

  async loadHistory(more = false): Promise<void> {
    const ticket = this.ticket();
    if (!ticket) return;
    this.historyStatus.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.history(ticket.key, {
          limit: HISTORY_PAGE,
          cursor: more ? this.historyCursor() : null,
        }),
      );
      this.history.update((list) => (more ? [...list, ...page.items] : page.items));
      this.historyUsers.update(
        (map) => new Map([...(more ? map : []), ...page.users.map((u) => [u.id, u] as const)]),
      );
      this.historyCursor.set(page.nextCursor);
      this.historyStatus.set('loaded');
    } catch (error) {
      this.historyStatus.set('error');
      this.toast.error(`Couldn't load the history: ${toApiError(error).title}`);
    }
  }

  // Links and children

  /// Links fromKey to targetKey; one of them is this ticket (inverse kinds such as "is blocked by" link from the other side).
  async addLink(fromKey: string, targetKey: string, type: TicketLinkType): Promise<void> {
    try {
      await firstValueFrom(this.api.link(fromKey, targetKey, type));
      await this.reload();
    } catch (error) {
      this.toast.error(
        `Couldn't link ${fromKey === this.key() ? targetKey : fromKey}: ${toApiError(error).title}`,
      );
    }
  }

  async removeLink(linkId: string): Promise<void> {
    const before = this.ticket();
    if (!before) return;
    this.ticket.set({ ...before, links: (before.links ?? []).filter((l) => l.id !== linkId) });
    try {
      await firstValueFrom(this.api.unlink(before.key, linkId));
      this.cache.put(this.ticket()!);
      void this.refreshMeta();
    } catch (error) {
      this.ticket.set(before);
      this.toast.error(`Couldn't remove the link: ${toApiError(error).title}`);
    }
  }

  async createChild(title: string, type: NewTicket['type']): Promise<boolean> {
    const ticket = this.ticket();
    if (!ticket) return false;
    try {
      const created = await firstValueFrom(
        this.api.create(
          ticket.projectKey,
          { title, type, parentKey: ticket.key },
          crypto.randomUUID(),
        ),
      );
      this.events.emit({ kind: 'created', ticket: created });
      await this.reload();
      return true;
    } catch (error) {
      this.toast.error(`Couldn't create the sub-ticket: ${toApiError(error).title}`);
      return false;
    }
  }

  async adoptChild(child: TicketRef): Promise<void> {
    const ticket = this.ticket();
    if (!ticket) return;
    try {
      const updated = await firstValueFrom(this.api.update(child.key, { parentKey: ticket.key }));
      this.cache.merge(updated.key, updated);
      this.events.emit({ kind: 'updated', ticket: updated });
      await this.reload();
    } catch (error) {
      this.toast.error(`Couldn't add ${child.key}: ${toApiError(error).title}`);
    }
  }

  /// Deletes at once with an Undo toast (D-82); the view closes on the `deleted` event.
  async delete(): Promise<void> {
    const ticket = this.ticket();
    if (ticket) await this.deletion.delete([ticket.key]);
  }

  private afterCommentChange(): void {
    const ticket = this.ticket();
    if (!ticket) return;
    const updated: Ticket = {
      ...ticket,
      comments: [...this.comments()],
      commentCount: this.commentCount(),
    };
    this.ticket.set(updated);
    void this.refreshMeta();
  }

  /// Comments, links and attachments bump the ticket's `UpdatedAt` and row version on the server: take
  /// the fresh ticket (keeping the comments loaded here) and refresh the activity list. The fields come
  /// along with the row version, so a stale copy is never passed on under a current version; a fresh
  /// copy that is not newer than the one shown (a later save answered first) is dropped.
  private async refreshMeta(): Promise<void> {
    const key = this.key();
    try {
      const fresh = await firstValueFrom(this.api.get(key));
      const current = this.ticket();
      if (current && current.id === fresh.id && isNewer(fresh, current)) {
        const merged: Ticket = {
          ...fresh,
          comments: current.comments,
          commentCount: current.commentCount,
          watchers: fresh.watchers ?? current.watchers,
        };
        this.ticket.set(merged);
        this.cache.put(merged);
        this.events.emit({ kind: 'updated', ticket: merged });
      }
    } catch {
      // The view keeps its current values; the next load brings the new ones.
    }
    if (this.historyStatus() !== 'idle') void this.loadHistory();
  }

  private applyServer(updated: Ticket): void {
    const merged = this.mergeKeepingCollections(updated);
    this.ticket.set(merged);
    this.cache.put(merged);
    this.events.emit({ kind: 'updated', ticket: merged });
  }

  /// PATCH responses carry no collections; keep the ones already loaded.
  private mergeKeepingCollections(ticket: Ticket): Ticket {
    const current = this.ticket();
    if (!current || current.id !== ticket.id) return ticket;
    return {
      ...ticket,
      children: ticket.children ?? current.children,
      childProgress: ticket.childProgress ?? current.childProgress,
      links: ticket.links ?? current.links,
      comments: ticket.comments ?? current.comments,
      commentCount: ticket.commentCount ?? current.commentCount,
      testCases: ticket.testCases ?? current.testCases,
      watchers: ticket.watchers ?? current.watchers,
    };
  }

  private setWatchers(ticketId: string, watchers: Watchers): void {
    const current = this.ticket();
    if (current?.id === ticketId) this.ticket.set({ ...current, watchers });
  }

  /// Server truth: into this view, the ticket cache and every other open view of the ticket.
  private publishWatchers(ticketId: string, watchers: Watchers): void {
    this.setWatchers(ticketId, watchers);
    const current = this.ticket();
    if (current?.id !== ticketId) return;
    this.cache.put(current);
    this.events.emit({ kind: 'updated', ticket: current });
  }

  /// Assigning someone makes them a watcher on the server (D-93).
  private async refreshWatchers(): Promise<void> {
    const ticket = this.ticket();
    if (!ticket) return;
    const token = this.watchToken;
    try {
      const watchers = await firstValueFrom(this.api.watchers(ticket.key));
      if (token === this.watchToken) this.publishWatchers(ticket.id, watchers);
    } catch {
      // The next load brings the current watchers.
    }
  }

  private setTicket(ticket: Ticket | null): void {
    this.ticket.set(ticket);
    this.comments.set(ticket?.comments ?? []);
    this.commentCount.set(ticket?.commentCount ?? ticket?.comments?.length ?? 0);
  }

  /// A child or linked ticket changed elsewhere: refresh our compact references to it.
  private refreshRelated(other: Ticket): void {
    const current = this.ticket();
    if (!current) return;
    const ref = (r: TicketRef): TicketRef =>
      r.id === other.id
        ? {
            ...r,
            title: other.title,
            status: other.status,
            priority: other.priority,
            type: other.type,
            assignee: other.assignee,
          }
        : r;
    const isChild = current.children?.some((c) => c.id === other.id) ?? false;
    const stillChild = other.parent?.id === current.id;
    if (!isChild && !(current.links?.some((l) => l.ticket.id === other.id) ?? false)) {
      if (stillChild) void this.reload();
      return;
    }
    if (isChild && !stillChild) {
      void this.reload();
      return;
    }
    const children = current.children?.map(ref) ?? null;
    this.ticket.set({
      ...current,
      children,
      childProgress: children ? progress(children) : current.childProgress,
      links: current.links?.map((l) => ({ ...l, ticket: ref(l.ticket) })) ?? null,
    });
  }
}

function progress(children: readonly TicketRef[]) {
  const done = children.filter((c) => c.status === 'Done').length;
  const toDo = children.filter((c) => c.status === 'ToDo').length;
  return { toDo, inProgress: children.length - done - toDo, done, total: children.length };
}
