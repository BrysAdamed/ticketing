import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Ticket, TicketSummary } from './ticket.models';

export type TicketEvent =
  | { kind: 'created'; ticket: TicketSummary }
  | { kind: 'updated'; ticket: Ticket }
  | { kind: 'deleted'; key: string };

/// In-app notifications between ticket views, so a change made in the peek panel or the create
/// dialog shows up in the backlog (and other lists) without a refetch.
@Injectable({ providedIn: 'root' })
export class TicketEvents {
  private readonly subject = new Subject<TicketEvent>();

  readonly events: Observable<TicketEvent> = this.subject.asObservable();

  emit(event: TicketEvent): void {
    this.subject.next(event);
  }
}
