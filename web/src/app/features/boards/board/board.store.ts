import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class BoardStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(boards): GET /boards/{id} with columns and CDK drag-drop (board.html mockup).
  load(_params: { boardId: string }): void {
    this.status.set('loaded');
  }
}
