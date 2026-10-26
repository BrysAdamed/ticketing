import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { RegressionsApi } from '@core/testing/testing.api';
import { BugOverrides, RegressionItem, RegressionItemChange, RegressionSession, RegressionSummary } from '@core/testing/testing.models';
import { TicketCreator } from '@core/tickets/create-ticket';
import { NewTicket, TicketSummary, UserRef } from '@core/tickets/ticket.models';
import { RegressionItemStatus } from '@shared/domain/enums';
import { buildRows, filterCounts, ItemFilter, matchesFilter, nextWaiting, orderedItems, replaceItem } from './session-logic';

/// State of the regression execution view (spec 6.11, layout-and-screens §3.8). Results are applied
/// optimistically and rolled back on failure; every server answer carries the refreshed summary.
@Injectable()
export class RegressionSessionStore {
  private readonly api = inject(RegressionsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly creator = inject(TicketCreator);

  readonly sessionKey = signal('');
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly session = signal<RegressionSession | null>(null);
  readonly items = signal<readonly RegressionItem[]>([]);
  readonly summary = signal<RegressionSummary | null>(null);
  readonly filter = signal<ItemFilter>('all');
  readonly text = signal('');
  readonly focusedKey = signal<string | null>(null);
  readonly busyKey = signal<string | null>(null);

  readonly meId = computed(() => this.auth.currentUser()?.id ?? null);
  readonly hasData = computed(() => this.session() !== null);
  readonly permissions = computed(() => this.session()?.permissions ?? { canExecute: false, canAssign: false, canComplete: false, canCancel: false });
  readonly counts = computed(() => filterCounts(this.items(), this.meId()));
  readonly rows = computed(() => buildRows(this.items().filter((i) => matchesFilter(i, this.filter(), this.meId(), this.text()))));
  readonly visible = computed(() => orderedItems(this.rows()));
  readonly focused = computed(() => this.items().find((i) => i.testCaseKey === this.focusedKey()) ?? null);

  async load(sessionKey: string, focusKey: string | null): Promise<void> {
    const key = sessionKey.toUpperCase();
    if (key !== this.sessionKey()) this.session.set(null);
    this.sessionKey.set(key);
    this.status.set('loading');
    try {
      const session = await firstValueFrom(this.api.get(key));
      if (this.sessionKey() !== key) return;
      this.session.set(session);
      this.items.set(session.items);
      this.summary.set(session.summary);
      this.error.set(null);
      this.status.set('loaded');
      this.focus(focusKey && session.items.some((i) => i.testCaseKey === focusKey) ? focusKey : this.firstToDo());
    } catch (error) {
      if (this.sessionKey() !== key) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  reload(): Promise<void> {
    return this.load(this.sessionKey(), this.focusedKey());
  }

  focus(key: string | null): void {
    this.focusedKey.set(key);
  }

  /// Moves the focus within the visible list (j/k).
  step(delta: number): void {
    const visible = this.visible();
    if (visible.length === 0) return;
    const index = visible.findIndex((i) => i.testCaseKey === this.focusedKey());
    const next = index === -1 ? 0 : Math.min(visible.length - 1, Math.max(0, index + delta));
    this.focus(visible[next].testCaseKey);
  }

  focusNextWaiting(): boolean {
    const next = nextWaiting(this.items(), this.focusedKey(), this.meId());
    if (next) this.focus(next.testCaseKey);
    return next !== null;
  }

  /// True when the item is assigned to someone other than the current user.
  takenByOther(item: RegressionItem): boolean {
    return item.assignee !== null && item.assignee.id !== this.meId();
  }

  async take(item: RegressionItem): Promise<boolean> {
    return this.run(item, () => this.api.take(this.sessionKey(), item.testCaseKey), this.me() ? { assignee: this.me() } : {});
  }

  async assign(item: RegressionItem, user: UserRef | null): Promise<boolean> {
    return this.run(item, () => this.api.assign(this.sessionKey(), item.testCaseKey, user?.id ?? null), { assignee: user });
  }

  /// Records a result (taking an item someone else holds first, when `takeOver` is set).
  async record(item: RegressionItem, status: RegressionItemStatus, note: string | null = null, takeOver = false): Promise<RegressionItem | null> {
    if (takeOver && !(await this.take(item))) return null;
    const current = this.items().find((i) => i.id === item.id) ?? item;
    const ok = await this.run(current, () => this.api.record(this.sessionKey(), current.testCaseKey, { status, note }), {
      status,
      resultNote: note,
      assignee: current.assignee ?? this.me(),
      autoPassed: false,
    });
    return ok ? (this.items().find((i) => i.id === item.id) ?? null) : null;
  }

  /// Opens the create-ticket dialog pre-filled with the server's bug draft; the bug is created through the item.
  async createBug(item: RegressionItem): Promise<TicketSummary | null> {
    let draft;
    try {
      draft = await firstValueFrom(this.api.bugDraft(this.sessionKey(), item.testCaseKey));
    } catch (error) {
      this.toast.error(error);
      return null;
    }
    return this.creator.open({
      projectKey: draft.projectKey,
      heading: `Create bug from ${item.testCaseKey}`,
      title: draft.title,
      type: 'Bug',
      description: draft.description,
      severity: draft.severity,
      priority: draft.priority,
      version: draft.version,
      labels: draft.labels,
      submit: async (_projectKey: string, ticket: NewTicket) => {
        const change = await firstValueFrom(this.api.createBug(this.sessionKey(), item.testCaseKey, overridesOf(ticket)));
        this.apply(change);
        if (!change.createdBug) throw new Error('The bug was not created.');
        this.toast.success(`${change.createdBug.key} created in the backlog.`);
        return change.createdBug;
      },
    });
  }

  async complete(skipRemaining: boolean): Promise<boolean> {
    try {
      await firstValueFrom(this.api.complete(this.sessionKey(), skipRemaining));
      this.toast.success(`${this.sessionKey()} completed.`);
      await this.reload();
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
  }

  async cancel(): Promise<boolean> {
    try {
      await firstValueFrom(this.api.cancel(this.sessionKey()));
      this.toast.success(`${this.sessionKey()} cancelled.`);
      await this.reload();
      return true;
    } catch (error) {
      this.toast.error(error);
      return false;
    }
  }

  private async run(item: RegressionItem, call: () => ReturnType<RegressionsApi['take']>, optimistic: Partial<RegressionItem>): Promise<boolean> {
    const before = this.items();
    this.items.set(replaceItem(before, { ...item, ...optimistic }));
    this.busyKey.set(item.testCaseKey);
    try {
      this.apply(await firstValueFrom(call()));
      return true;
    } catch (error) {
      this.items.set(before);
      const apiError = toApiError(error);
      this.toast.error(apiError);
      if (apiError.code === 'regression.notInProgress' || apiError.code === 'concurrency.conflict') await this.reload();
      return false;
    } finally {
      this.busyKey.set(null);
    }
  }

  private apply(change: RegressionItemChange): void {
    this.items.update((items) => replaceItem(items, change.item));
    this.summary.set(change.summary);
  }

  private me(): UserRef | null {
    const user = this.auth.currentUser();
    return user ? { id: user.id, email: user.email, displayName: user.displayName, isActive: true } : null;
  }

  private firstToDo(): string | null {
    const visible = this.visible();
    return (visible.find((i) => i.status === 'WaitingForExecution') ?? visible[0])?.testCaseKey ?? null;
  }
}

function overridesOf(ticket: NewTicket): BugOverrides {
  return {
    title: ticket.title,
    description: ticket.description ?? null,
    severity: ticket.severity ?? null,
    priority: ticket.priority,
    version: ticket.version ?? null,
    labels: ticket.labels,
    assignee: ticket.assignee ?? null,
  };
}
