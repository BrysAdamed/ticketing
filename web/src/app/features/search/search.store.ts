import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { LoadStatus } from '@core/projects/project-directory';
import { TicketSummary } from '@core/tickets/ticket.models';
import { EMPTY_SEARCH, SearchFilters, searchQueryString, toSearchParams } from './search-query';

/// `GET /api/v1/tickets/search` response.
export interface TicketSearchPage {
  items: TicketSummary[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
}

export const PAGE_SIZE = 50;

/// Search results for the filters in the URL: the first page replaces the list (the previous
/// request is cancelled), further pages append. Keyboard focus is an index into the results.
@Injectable()
export class SearchStore {
  private readonly api = inject(ApiClient);

  readonly filters = signal<SearchFilters>(EMPTY_SEARCH);
  readonly items = signal<readonly TicketSummary[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly total = signal<number | null>(null);
  readonly totalCapped = signal(false);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly loadingMore = signal(false);
  readonly focusIndex = signal(-1);
  readonly hasData = computed(() => this.status() === 'loaded' || this.items().length > 0);
  readonly focused = computed(() => this.items()[this.focusIndex()] ?? null);
  readonly exportUrl = computed(() => {
    const query = searchQueryString(this.filters());
    return this.api.url(`/tickets/search/export.csv${query ? `?${query}` : ''}`);
  });

  private request: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  search(filters: SearchFilters): void {
    this.request?.unsubscribe();
    this.filters.set(filters);
    this.status.set('loading');
    this.error.set(null);
    this.loadingMore.set(false);
    this.request = this.api.get<TicketSearchPage>('/tickets/search', { ...toSearchParams(filters), limit: PAGE_SIZE }).subscribe({
      next: (page) => {
        this.items.set(page.items);
        this.nextCursor.set(page.nextCursor);
        this.total.set(page.total);
        this.totalCapped.set(page.totalCapped);
        this.focusIndex.set(page.items.length ? Math.min(Math.max(this.focusIndex(), 0), page.items.length - 1) : -1);
        this.status.set('loaded');
      },
      error: (error: unknown) => {
        this.items.set([]);
        this.total.set(null);
        this.nextCursor.set(null);
        this.error.set(toApiError(error));
        this.status.set('error');
      },
    });
  }

  reload(): void {
    this.search(this.filters());
  }

  loadMore(): void {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore() || this.status() !== 'loaded') return;
    this.loadingMore.set(true);
    this.request = this.api
      .get<TicketSearchPage>('/tickets/search', { ...toSearchParams(this.filters()), limit: PAGE_SIZE, cursor })
      .subscribe({
        next: (page) => {
          this.items.update((items) => [...items, ...page.items]);
          this.nextCursor.set(page.nextCursor);
          this.loadingMore.set(false);
        },
        error: () => this.loadingMore.set(false),
      });
  }

  move(delta: number): void {
    const count = this.items().length;
    if (!count) return;
    const next = Math.min(Math.max(this.focusIndex() + delta, 0), count - 1);
    this.focusIndex.set(next);
    if (next >= count - 10) this.loadMore();
  }
}
