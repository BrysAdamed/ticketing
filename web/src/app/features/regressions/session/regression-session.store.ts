import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class RegressionSessionStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(regressions): GET /regression-sessions/{sessionKey} and the execution two-pane view (layout-and-screens 3.8).
  load(_params: { projectKey: string; sessionKey: string }): void {
    this.status.set('loaded');
  }
}
