import { EnvironmentProviders } from '@angular/core';
import { provideTicketDetailSection } from '@core/tickets/ticket-sections';

/// Registers the attachments section in the ticket view (below test cases).
export function provideAttachments(): EnvironmentProviders {
  return provideTicketDetailSection({
    id: 'attachments',
    order: 20,
    title: 'Attachments',
    loadComponent: () => import('./attachments-section.component').then((m) => m.AttachmentsSectionComponent),
  });
}
