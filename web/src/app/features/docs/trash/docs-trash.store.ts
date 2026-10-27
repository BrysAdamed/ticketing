import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { DocTrashItem } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { LoadStatus } from '@core/projects/project-directory';
import { DocTreeStore } from '../tree/doc-tree.store';

const PAGE_SIZE = 50;

/// Docs trash (`docs.trash`, Owners only): delete groups newest first, paged, each restorable.
@Injectable()
export class DocsTrashStore {
  private readonly api = inject(DocsApi);
  private readonly tree = inject(DocTreeStore);
  private projectKey = '';

  readonly items = signal<readonly DocTrashItem[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly loadingMore = signal(false);
  readonly restoring = signal<ReadonlySet<string>>(new Set());

  async load(projectKey: string): Promise<void> {
    this.projectKey = projectKey;
    this.status.set('loading');
    try {
      const page = await firstValueFrom(this.api.trash(projectKey, { limit: PAGE_SIZE }));
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(
        this.api.trash(this.projectKey, { limit: PAGE_SIZE, cursor }),
      );
      this.items.update((items) => [...items, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /// Restores a group through the tree (which reloads and reveals it); the row leaves the list.
  async restore(item: DocTrashItem): Promise<boolean> {
    this.restoring.update((set) => new Set([...set, item.key]));
    const doc = await this.tree.restore(item.key);
    this.restoring.update((set) => new Set([...set].filter((k) => k !== item.key)));
    if (doc) this.items.update((items) => items.filter((i) => i.key !== item.key));
    return !!doc;
  }
}
