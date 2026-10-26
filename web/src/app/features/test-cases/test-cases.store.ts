import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class TestCasesStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(test-cases): GET /projects/{key}/test-cases with status counts (spec 6.10).
  load(_params: { projectKey: string }): void {
    this.status.set('loaded');
  }
}
