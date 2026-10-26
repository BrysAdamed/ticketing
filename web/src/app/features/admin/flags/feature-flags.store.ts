import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class FeatureFlagsStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(admin): feature flag CRUD with targeting (spec 6.13).
  load(): void {
    this.status.set('loaded');
  }
}
