import {
  computed,
  Injectable,
  InjectionToken,
  makeEnvironmentProviders,
  Provider,
  signal,
  Type,
} from '@angular/core';
import { Observable, Subject } from 'rxjs';
import { Ticket } from './ticket.models';

/// An action contributed to the ticket view's header bar by another feature (Delegate to agent, …).
/// The component receives the inputs `ticket` and `presentation` ('page' | 'peek'), and is rendered
/// in ascending `order` before the view's own buttons. It may add items to the `…` menu and react to
/// shortcuts through the view's `TicketHeaderHost`.
export interface TicketHeaderAction {
  /// Stable id, also used as `data-testid="ticket-action-<id>"`.
  readonly id: string;
  readonly order: number;
  readonly loadComponent: () => Promise<Type<unknown>>;
}

/// Inputs every header action component can declare (`input.required<…>()` for each it needs).
export interface TicketHeaderActionInputs {
  ticket: Ticket;
  presentation: 'page' | 'peek';
}

/// An entry a header action adds to the ticket view's `…` menu.
export interface TicketMenuItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly disabled?: boolean;
  readonly run: () => void;
}

export const TICKET_HEADER_ACTIONS = new InjectionToken<readonly TicketHeaderAction[]>(
  'TICKET_HEADER_ACTIONS',
  { factory: () => [] },
);

/// Registers a ticket header action. Call it in `app.config.ts` of the contributing feature:
/// `provideTicketHeaderAction({ id: 'delegate', order: 10, loadComponent: () => import(...).then(m => m.X) })`.
export function provideTicketHeaderAction(
  action: TicketHeaderAction,
): ReturnType<typeof makeEnvironmentProviders> {
  const provider: Provider = { provide: TICKET_HEADER_ACTIONS, useValue: action, multi: true };
  return makeEnvironmentProviders([provider]);
}

/// One per open ticket view (page or peek), provided by the view: the `…` menu items header actions
/// contribute, whether the view's shortcuts are live (a page behind an open peek is not), and a way
/// to ask the view to reload the ticket and its history after a write it didn't make itself.
@Injectable()
export class TicketHeaderHost {
  private readonly items = signal<ReadonlyMap<string, readonly TicketMenuItem[]>>(new Map());
  private readonly refreshes = new Subject<void>();

  readonly shortcutsActive = signal(false);
  readonly menuItems = computed(() => [...this.items().values()].flat());
  readonly refreshRequests: Observable<void> = this.refreshes.asObservable();

  /// Replaces the `…` menu items of one action (`owner` is its id); an empty list removes them.
  setMenuItems(owner: string, items: readonly TicketMenuItem[]): void {
    this.items.update((map) => {
      const next = new Map(map);
      if (items.length) next.set(owner, items);
      else next.delete(owner);
      return next;
    });
  }

  refresh(): void {
    this.refreshes.next();
  }
}
