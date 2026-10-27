import { inject, Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { SwrCache } from '../api/swr-cache';
import { Ticket, TicketSummary } from './ticket.models';

export type TicketEvent =
  | { kind: 'created'; ticket: TicketSummary }
  | { kind: 'updated'; ticket: Ticket }
  | { kind: 'deleted'; key: string }
  | { kind: 'restored'; ticket: Ticket };

/// Cache tag of every cached read model that lists a project's tickets (backlog, dashboard).
export function ticketsTag(projectKey: string): string {
  return `tickets:${projectKey.toUpperCase()}`;
}

/// Cache tag of the signed-in user's My work page.
export const MY_WORK_TAG = 'my-work';

/// In-app notifications between ticket views, so a change made in the peek panel or the create
/// dialog shows up in the backlog (and other lists) without a refetch. Every event also drops the
/// cached ticket lists it made stale (SwrCache), so a revisited list never shows the old state.
@Injectable({ providedIn: 'root' })
export class TicketEvents {
  private readonly subject = new Subject<TicketEvent>();
  private readonly cache = inject(SwrCache);

  readonly events: Observable<TicketEvent> = this.subject.asObservable();

  emit(event: TicketEvent): void {
    const projectKey = event.kind === 'deleted' ? event.key.split('-')[0] : event.ticket.projectKey;
    this.cache.invalidate(ticketsTag(projectKey));
    this.cache.invalidate(MY_WORK_TAG);
    this.subject.next(event);
  }
}
