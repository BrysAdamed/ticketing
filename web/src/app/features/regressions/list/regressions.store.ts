import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class RegressionsStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(regressions): GET /projects/{key}/regression-sessions with summaries (spec 6.11).
  load(_params: { projectKey: string }): void {
    this.status.set('loaded');
  }
}
