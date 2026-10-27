import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { DocSearchApi, DocSearchItem, DocSearchPage } from '@core/docs/doc-search.api';
import { LoadStatus } from '@core/projects/project-directory';
import { DocSearchFilters, EMPTY_DOC_SEARCH, toDocApiParams } from './doc-search-query';

export const DOC_PAGE_SIZE = 50;

/// Docs search results for the filters in the URL: the first page replaces the list (cancelling
/// the previous request); with the updated sort further pages append. Focus is an index into the list.
@Injectable()
export class DocSearchStore {
  private readonly api = inject(DocSearchApi);

  readonly filters = signal<DocSearchFilters>(EMPTY_DOC_SEARCH);
  readonly items = signal<readonly DocSearchItem[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly total = signal<number | null>(null);
  readonly totalCapped = signal(false);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly loadingMore = signal(false);
  readonly focusIndex = signal(-1);
  readonly hasData = computed(() => this.status() === 'loaded' || this.items().length > 0);
  readonly focused = computed(() => this.items()[this.focusIndex()] ?? null);

  private request: Subscription | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.request?.unsubscribe());
  }

  search(filters: DocSearchFilters): void {
    this.request?.unsubscribe();
    this.filters.set(filters);
    this.status.set('loading');
    this.error.set(null);
    this.loadingMore.set(false);
    this.request = this.api.search({ ...toDocApiParams(filters), limit: DOC_PAGE_SIZE }).subscribe({
      next: (page) => this.loaded(page),
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
      .search({ ...toDocApiParams(this.filters()), limit: DOC_PAGE_SIZE, cursor })
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
    if (next >= count - 5) this.loadMore();
  }

  private loaded(page: DocSearchPage): void {
    this.items.set(page.items);
    this.nextCursor.set(page.nextCursor);
    this.total.set(page.total);
    this.totalCapped.set(page.totalCapped);
    this.focusIndex.set(
      page.items.length ? Math.min(Math.max(this.focusIndex(), 0), page.items.length - 1) : -1,
    );
    this.status.set('loaded');
  }
}
