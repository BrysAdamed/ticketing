import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class SearchStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(search): ticket search with URL-bound filters and CSV export (spec 6.8); register a remote palette SearchProvider.
  load(): void {
    this.status.set('loaded');
  }
}
