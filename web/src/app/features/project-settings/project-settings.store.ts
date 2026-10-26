import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class ProjectSettingsStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(project-settings): project details, members and visibility (PATCH /projects/{key} with If-Match).
  load(_params: { projectKey: string }): void {
    this.status.set('loaded');
  }
}
