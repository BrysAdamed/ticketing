import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { projectKeyOfDoc } from '@core/docs/doc-links';
import { Doc } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { LoadStatus } from '@core/projects/project-directory';
import { docsTreeTag } from '../tree/doc-tree.store';

/// The open doc (`GET /docs/{key}`), cached per key so a revisit paints at once. Provided by the
/// doc view, so the content views (page, diagram, folder) and later the editor share it; call
/// `set` after a write that returns the doc.
@Injectable()
export class DocStore {
  private readonly api = inject(DocsApi);
  private readonly cache = inject(SwrCache);
  private generation = 0;

  readonly key = signal('');
  readonly doc = signal<Doc | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  async load(key: string): Promise<void> {
    const generation = ++this.generation;
    this.key.set(key);
    this.error.set(null);
    const { cached, fresh } = this.cache.load(
      cacheKey(key),
      () => firstValueFrom(this.api.get(key)),
      [`doc:${key}`, docsTreeTag(projectKeyOfDoc(key))],
    );
    if (cached) {
      this.doc.set(cached);
      this.status.set('loaded');
    } else {
      this.doc.set(null);
      this.status.set('loading');
    }
    try {
      const doc = await fresh;
      if (generation !== this.generation) return;
      this.doc.set(doc);
      this.status.set('loaded');
    } catch (error) {
      if (generation !== this.generation) return;
      const apiError = toApiError(error);
      if (cached && !apiError.isNotFound) return;
      this.cache.invalidate(`doc:${key}`);
      this.doc.set(null);
      this.error.set(apiError);
      this.status.set('error');
    }
  }

  reload(): Promise<void> {
    return this.load(this.key());
  }

  /// Refetches the open doc in the background (after a move or rename changed its path).
  async refresh(): Promise<void> {
    const key = this.key();
    if (!key || !this.doc()) return;
    try {
      const doc = await firstValueFrom(this.api.get(key));
      if (this.key() === key) this.set(doc);
    } catch {
      return;
    }
  }

  set(doc: Doc): void {
    this.doc.set(doc);
    this.cache.set(cacheKey(doc.key), doc, [`doc:${doc.key}`, docsTreeTag(doc.projectKey)]);
  }
}

function cacheKey(key: string): string {
  return `doc:${key}`;
}
