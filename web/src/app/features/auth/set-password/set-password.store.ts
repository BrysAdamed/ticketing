import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class SetPasswordStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(auth): POST /auth/set-password with the one-time token (spec 6.14).
  load(_params: { token: string | null }): void {
    this.status.set('loaded');
  }
}
