import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { TicketDetailStore } from './ticket-detail.store';

export type TicketPresentation = 'page' | 'peek';

@Component({
  selector: 'tk-ticket-detail-view',
  imports: [PagePlaceholderComponent],
  providers: [TicketDetailStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'tk-page',
    'data-testid': 'view-ticket.detail',
    '[attr.data-presentation]': 'presentation()',
  },
  template: `
    @if (presentation() === 'page') {
      <header class="tk-page-header">
        <h1 class="tnum">{{ store.ticketKey() }}</h1>
      </header>
    }
    <tk-page-placeholder
      icon="tablerFileText"
      [title]="store.ticketKey()"
      viewId="ticket.detail"
      description="Ticket detail (ticket-detail.html mockup) is not built yet."
    />
  `,
})
export class TicketDetailView {
  protected readonly store = inject(TicketDetailStore);

  readonly ticketKey = input.required<string>();
  readonly presentation = input<TicketPresentation>('page');

  constructor() {
    effect(() => this.store.load(this.ticketKey()));
  }
}
