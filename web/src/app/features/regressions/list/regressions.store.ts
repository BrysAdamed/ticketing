import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { RegressionsApi } from '@core/testing/testing.api';
import { RegressionSessionSummary } from '@core/testing/testing.models';
import { RegressionSessionStatus } from '@shared/domain/enums';

export type SessionFilter = RegressionSessionStatus | 'All';

const PAGE_SIZE = 50;

/// Regression sessions of a project, newest first (spec 6.11, layout-and-screens §3.7).
@Injectable()
export class RegressionsStore {
  private readonly api = inject(RegressionsApi);
  private readonly toast = inject(ToastService);
  private request = 0;

  readonly projectKey = signal('');
  readonly filter = signal<SessionFilter>('All');
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly sessions = signal<readonly RegressionSessionSummary[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly loadingMore = signal(false);

  readonly hasData = computed(() => this.status() === 'loaded' || this.sessions().length > 0);

  async load(projectKey: string, filter: SessionFilter): Promise<void> {
    if (projectKey !== this.projectKey()) this.sessions.set([]);
    this.projectKey.set(projectKey);
    this.filter.set(filter);
    const request = ++this.request;
    this.status.set('loading');
    try {
      const page = await firstValueFrom(this.api.list(projectKey, this.query(filter)));
      if (request !== this.request) return;
      this.sessions.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (request !== this.request) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  reload(): Promise<void> {
    return this.load(this.projectKey(), this.filter());
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const request = this.request;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(this.api.list(this.projectKey(), { ...this.query(this.filter()), cursor }));
      if (request !== this.request) return;
      this.sessions.update((sessions) => [...sessions, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.loadingMore.set(false);
    }
  }

  private query(filter: SessionFilter) {
    return { status: filter === 'All' ? undefined : [filter], limit: PAGE_SIZE };
  }
}
