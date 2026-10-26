import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class AdminUsersStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(admin): user administration and set-password links (spec 6.14).
  load(): void {
    this.status.set('loaded');
  }
}
