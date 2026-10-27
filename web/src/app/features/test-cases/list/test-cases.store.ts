import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { TestCasesApi } from '@core/testing/testing.api';
import { TestCase, TestCaseCounts, TestCaseSummary } from '@core/testing/testing.models';
import { TestCaseDraft } from '../editor/test-case-form';
import {
  adjustCounts,
  EMPTY_FILTERS,
  matches,
  summaryOf,
  TestCaseFilters,
  upsertRow,
} from './test-case-list-logic';

const PAGE_SIZE = 100;
const NO_COUNTS: TestCaseCounts = { new: 0, manual: 0, automatic: 0, archived: 0, active: 0 };

/// State of the project's test case list (spec 6.10, layout-and-screens §3.6). Loads pages of 100 by
/// number; the editor pushes its saves here so the list updates without a refetch.
@Injectable()
export class TestCasesStore {
  private readonly api = inject(TestCasesApi);
  private readonly toast = inject(ToastService);
  private request = 0;
  private readonly drafts = new Map<string, TestCaseDraft>();

  readonly projectKey = signal('');
  readonly filters = signal<TestCaseFilters>(EMPTY_FILTERS);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly items = signal<readonly TestCaseSummary[]>([]);
  readonly counts = signal<TestCaseCounts>(NO_COUNTS);
  readonly nextCursor = signal<string | null>(null);
  readonly loadingMore = signal(false);

  readonly hasData = computed(() => this.status() === 'loaded' || this.items().length > 0);

  async load(projectKey: string, filters: TestCaseFilters): Promise<void> {
    const sameProject = projectKey === this.projectKey();
    this.projectKey.set(projectKey);
    this.filters.set(filters);
    if (!sameProject) {
      this.items.set([]);
      this.counts.set(NO_COUNTS);
    }
    const request = ++this.request;
    this.status.set('loading');
    try {
      const page = await firstValueFrom(this.api.list(projectKey, this.query(filters)));
      if (request !== this.request) return;
      this.items.set(page.items);
      this.counts.set(page.counts);
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
    return this.load(this.projectKey(), this.filters());
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const request = this.request;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(
        this.api.list(this.projectKey(), { ...this.query(this.filters()), cursor }),
      );
      if (request !== this.request) return;
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.toast.error(error);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /// Applies a created or edited test case from the editor.
  saved(testCase: TestCase): void {
    const row = summaryOf(testCase);
    const before = this.items().find((r) => r.id === row.id) ?? null;
    if (this.countable(row)) this.counts.update((c) => adjustCounts(c, before, row));
    this.items.update((items) => upsertRow(items, row, this.filters()));
  }

  /// Unsaved editor changes, by test case key (or `new`), restored when the case is opened again.
  keepDraft(key: string, draft: TestCaseDraft): void {
    this.drafts.set(key, draft);
  }

  takeDraft(key: string): TestCaseDraft | null {
    const draft = this.drafts.get(key) ?? null;
    this.drafts.delete(key);
    return draft;
  }

  deleted(testCase: TestCase): void {
    this.drafts.delete(testCase.key);
    const before = this.items().find((r) => r.id === testCase.id) ?? summaryOf(testCase);
    if (this.countable(before)) this.counts.update((c) => adjustCounts(c, before, null));
    this.items.update((items) => items.filter((r) => r.id !== testCase.id));
  }

  private countable(row: TestCaseSummary): boolean {
    return matches(row, { ...this.filters(), status: 'All', archived: true });
  }

  private query(filters: TestCaseFilters) {
    return {
      status: filters.status === 'All' ? undefined : [filters.status],
      text: filters.text.trim() || null,
      ticket: filters.ticket,
      includeArchived: filters.archived || undefined,
      limit: PAGE_SIZE,
    };
  }
}
