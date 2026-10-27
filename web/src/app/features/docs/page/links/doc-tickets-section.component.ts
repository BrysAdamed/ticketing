import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { Doc, DocTicketReference } from '@core/docs/doc.models';
import { PeekService } from '@core/layout/peek/peek';
import { TICKET_STATUS_LABELS } from '@shared/domain/enums';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';

/// "Tickets mentioned" (spec 1.8, 1.9): the tickets the page names that the reader may see, from
/// the doc's `references` (no extra request). A row opens the ticket peek; hidden when empty.
@Component({
  selector: 'tk-doc-tickets-section',
  imports: [StatusIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'doc-tickets', '[class.tk-section-empty]': '!tickets().length' },
  template: `
    @if (tickets().length) {
      <div class="sec-h">
        <h2>Tickets mentioned</h2>
        <span class="n tnum">{{ tickets().length }}</span>
      </div>
      <div class="box" role="list">
        @for (ticket of tickets(); track ticket.id) {
          <a
            class="lrow"
            role="listitem"
            [href]="ticket.url"
            [title]="ticket.title + ' · ' + statusLabels[ticket.status]"
            [attr.data-testid]="'doc-ticket-' + ticket.key"
            (click)="open($event, ticket)"
          >
            <tk-status-icon [status]="ticket.status" />
            <span class="key">{{ ticket.key }}</span>
            <span class="t">{{ ticket.title }}</span>
          </a>
        }
      </div>
    }
  `,
  styleUrl: './doc-links-section.scss',
})
export class DocTicketsSectionComponent {
  private readonly peek = inject(PeekService);

  readonly doc = input.required<Doc>();

  protected readonly statusLabels = TICKET_STATUS_LABELS;
  protected readonly tickets = computed(() => this.doc().references.tickets);

  protected open(event: MouseEvent, ticket: DocTicketReference): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)
      return;
    event.preventDefault();
    this.peek.open(ticket.key);
  }
}
