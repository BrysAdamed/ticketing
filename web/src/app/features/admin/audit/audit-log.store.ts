import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class AuditLogStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(admin): admin audit trail from activity entries (spec 4.14).
  load(): void {
    this.status.set('loaded');
  }
}
