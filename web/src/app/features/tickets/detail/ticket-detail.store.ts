import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class TicketDetailStore {
  readonly ticketKey = signal('');
  readonly status = signal<LoadStatus>('idle');

  // TODO(tickets): GET /tickets/{key} (+ comments, children, links, test cases) and PATCH with If-Match.
  load(ticketKey: string): void {
    this.ticketKey.set(ticketKey.toUpperCase());
    this.status.set('loaded');
  }
}
