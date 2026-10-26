import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class AccessTokensStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(profile): list, create (show-once dialog) and revoke personal access tokens (spec 6.12).
  load(): void {
    this.status.set('loaded');
  }
}
