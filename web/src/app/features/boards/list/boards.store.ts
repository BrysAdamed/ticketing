import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class BoardsStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(boards): GET /boards (spec 5.4) and the New board dialog.
  load(): void {
    this.status.set('loaded');
  }
}
