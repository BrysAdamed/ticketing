import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { DocHistoryApi, DocHistoryItem, DocHistoryPage } from '@core/docs/doc-history.api';
import { DocVersion } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { LoadStatus } from '@core/projects/project-directory';

/// The history panel of one doc: the first page cached per doc (stale-while-revalidate), "Load
/// more" pages, and published versions with their content (immutable, so fetched once).
@Injectable()
export class DocHistoryStore {
  private readonly api = inject(DocHistoryApi);
  private readonly docs = inject(DocsApi);
  private readonly cache = inject(SwrCache);
  private readonly versions = new Map<string, Promise<DocVersion>>();
  private generation = 0;

  readonly key = signal('');
  readonly items = signal<DocHistoryItem[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly loadingMore = signal(false);

  async load(key: string): Promise<void> {
    const generation = ++this.generation;
    this.key.set(key);
    this.error.set(null);
    const { cached, fresh } = this.cache.load(
      `doc-history:${key}`,
      () => firstValueFrom(this.api.history(key)),
      [`doc:${key}`],
    );
    if (cached) this.apply(cached);
    else this.status.set('loading');
    try {
      const page = await fresh;
      if (generation === this.generation) this.apply(page);
    } catch (error) {
      if (generation !== this.generation || cached) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const generation = this.generation;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(this.api.history(this.key(), cursor));
      if (generation !== this.generation) return;
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.error.set(toApiError(error));
    } finally {
      this.loadingMore.set(false);
    }
  }

  version(key: string, number: number): Promise<DocVersion> {
    const id = `${key}:${number}`;
    let version = this.versions.get(id);
    if (!version) {
      version = firstValueFrom(this.docs.version(key, number));
      version.catch(() => this.versions.delete(id));
      this.versions.set(id, version);
    }
    return version;
  }

  private apply(page: DocHistoryPage): void {
    this.items.set(page.items);
    this.nextCursor.set(page.nextCursor);
    this.status.set('loaded');
  }
}
