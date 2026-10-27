import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { LoadStatus } from '@core/projects/project-directory';
import { MY_WORK_TAG } from '@core/tickets/ticket-events';
import { TicketSummary } from '@core/tickets/ticket.models';
import { ExecutionMode } from '@shared/domain/enums';

/// `GET /api/v1/me/work` (spec 6.8, I-08).
export interface MyWork {
  projects: MyWorkProject[];
  ticketCount: number;
  truncated: boolean;
  regressionItems: MyRegressionItem[];
}

export interface MyWorkProject {
  projectKey: string;
  projectName: string;
  tickets: TicketSummary[];
}

export interface MyRegressionItem {
  itemId: string;
  testCaseKey: string;
  title: string;
  executionMode: ExecutionMode;
  sessionId: string;
  sessionKey: string;
  sessionName: string;
  sessionVersion: string | null;
  projectKey: string;
  url: string;
}

/// One entry of the keyboard-navigable list: tickets of every group, then regression items.
export type WorkEntry =
  { kind: 'ticket'; ticket: TicketSummary } | { kind: 'item'; item: MyRegressionItem };

/// My work: open tickets assigned to me grouped by project, plus my waiting regression items.
@Injectable()
export class MyWorkStore {
  private readonly api = inject(ApiClient);
  private readonly cache = inject(SwrCache);

  readonly work = signal<MyWork | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly collapsed = signal<ReadonlySet<string>>(new Set());
  readonly focusIndex = signal(-1);

  readonly projects = computed(() => this.work()?.projects ?? []);
  readonly items = computed(() => this.work()?.regressionItems ?? []);
  readonly isEmpty = computed(() => this.projects().length === 0 && this.items().length === 0);
  /// Visible entries in display order (collapsed groups are skipped).
  readonly entries = computed<WorkEntry[]>(() => [
    ...this.projects()
      .filter((p) => !this.collapsed().has(p.projectKey))
      .flatMap((p) => p.tickets.map((ticket) => ({ kind: 'ticket' as const, ticket }))),
    ...(this.collapsed().has(REGRESSIONS_GROUP)
      ? []
      : this.items().map((item) => ({ kind: 'item' as const, item }))),
  ]);
  readonly focused = computed(() => this.entries()[this.focusIndex()] ?? null);

  /// Shows the last My work at once (stale-while-revalidate), then the fresh one.
  async load(): Promise<void> {
    const { cached, fresh } = this.cache.load(
      MY_WORK_TAG,
      () => firstValueFrom(this.api.get<MyWork>('/me/work')),
      [MY_WORK_TAG],
    );
    if (cached) this.work.set(cached);
    this.status.set(this.work() ? 'loaded' : 'loading');
    try {
      this.work.set(await fresh);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      if (!this.work()) this.status.set('error');
    }
  }

  toggle(group: string): void {
    this.collapsed.update((set) => {
      const next = new Set(set);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }

  move(delta: number): void {
    const count = this.entries().length;
    if (count) this.focusIndex.set(Math.min(Math.max(this.focusIndex() + delta, 0), count - 1));
  }
}

export const REGRESSIONS_GROUP = 'regressions';
