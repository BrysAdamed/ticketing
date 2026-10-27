import { EnvironmentProviders } from '@angular/core';
import { provideTicketDetailSection } from '@core/tickets/ticket-sections';

/// What Docs adds outside its own routes: the "Docs mentioning this ticket" section of the ticket
/// view (below test cases and attachments, hidden while no readable doc mentions the ticket).
export function provideDocsTicketSection(): EnvironmentProviders {
  return provideTicketDetailSection({
    id: 'docs',
    order: 30,
    title: 'Docs mentioning this ticket',
    loadComponent: () =>
      import('./ticket-section/ticket-docs-section.component').then(
        (m) => m.TicketDocsSectionComponent,
      ),
  });
}
