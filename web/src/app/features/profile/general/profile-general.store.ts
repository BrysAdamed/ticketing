import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class ProfileGeneralStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(profile): change display name and password (spec 6.14).
  load(): void {
    this.status.set('loaded');
  }
}
