import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { DocSummary } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { LoadStatus } from '@core/projects/project-directory';
import { docsTreeTag } from '../tree/doc-tree.store';

const RECENT_LIMIT = 10;

/// Docs home (spec 1.15): the project's recently updated pages and diagrams, cached per project.
@Injectable()
export class DocsHomeStore {
  private readonly api = inject(DocsApi);
  private readonly cache = inject(SwrCache);
  private generation = 0;

  readonly recent = signal<readonly DocSummary[]>([]);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);

  async load(projectKey: string): Promise<void> {
    const generation = ++this.generation;
    const { cached, fresh } = this.cache.load(
      `docs.recent:${projectKey}`,
      () => firstValueFrom(this.api.recent(projectKey, RECENT_LIMIT)),
      [`project:${projectKey}`, docsTreeTag(projectKey)],
    );
    if (cached) {
      this.recent.set(cached);
      this.status.set('loaded');
    } else {
      this.status.set('loading');
    }
    try {
      const recent = await fresh;
      if (generation !== this.generation) return;
      this.recent.set(recent);
      this.status.set('loaded');
    } catch (error) {
      if (generation !== this.generation || cached) return;
      this.error.set(toApiError(error).title);
      this.status.set('error');
    }
  }
}
