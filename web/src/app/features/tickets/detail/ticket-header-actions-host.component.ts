import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
  Type,
} from '@angular/core';
import { TICKET_HEADER_ACTIONS, TicketHeaderAction } from '@core/tickets/ticket-header-actions';
import { Ticket } from '@core/tickets/ticket.models';

interface LoadedAction {
  action: TicketHeaderAction;
  component: Type<unknown> | null;
}

/// Renders the header actions other features contributed through `TICKET_HEADER_ACTIONS`, each
/// lazily loaded and given `ticket` and `presentation`. An action that fails to load is left out.
@Component({
  selector: 'tk-ticket-header-actions-host',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (entry of actions(); track entry.action.id) {
      @if (entry.component; as component) {
        <span class="action" [attr.data-testid]="'ticket-action-' + entry.action.id">
          <ng-container [ngComponentOutlet]="component" [ngComponentOutletInputs]="inputs()" />
        </span>
      }
    }
  `,
  styles: `
    :host,
    .action {
      display: inline-flex;
      align-items: center;
      gap: 2px;
    }
  `,
})
export class TicketHeaderActionsHostComponent {
  readonly ticket = input.required<Ticket>();
  readonly presentation = input.required<'page' | 'peek'>();

  protected readonly inputs = computed(() => ({
    ticket: this.ticket(),
    presentation: this.presentation(),
  }));
  protected readonly actions = signal<LoadedAction[]>([]);

  constructor() {
    const registered = [...inject(TICKET_HEADER_ACTIONS)].sort((a, b) => a.order - b.order);
    this.actions.set(registered.map((action) => ({ action, component: null })));
    for (const action of registered) {
      action
        .loadComponent()
        .then((component) => this.loaded(action.id, component))
        .catch(() => this.actions.update((list) => list.filter((a) => a.action.id !== action.id)));
    }
  }

  private loaded(id: string, component: Type<unknown>): void {
    this.actions.update((list) => list.map((a) => (a.action.id === id ? { ...a, component } : a)));
  }
}
