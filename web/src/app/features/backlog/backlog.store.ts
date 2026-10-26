import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class BacklogStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(backlog): load the project backlog (tickets with no board, ordered by rank) and implement backlog.html.
  load(_params: { projectKey: string }): void {
    this.status.set('loaded');
  }
}
