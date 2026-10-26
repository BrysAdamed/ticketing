import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class MyWorkStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(my-work): GET /tickets?assignee=me&statusCategory=open grouped by project + my waiting regression items (spec 6.8).
  load(): void {
    this.status.set('loaded');
  }
}
