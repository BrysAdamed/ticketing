import { InjectionToken, makeEnvironmentProviders, Provider, Type } from '@angular/core';

/// A section contributed to the ticket view by another feature (test cases, attachments, …).
/// The component receives the inputs `ticketKey`, `ticketId` and `projectKey`, and is re-created
/// when the ticket changes. Sections are rendered in ascending `order` below the built-in
/// sub-tickets and links sections and above the activity.
export interface TicketDetailSection {
  /// Stable id, also used as `data-testid="ticket-section-<id>"`.
  readonly id: string;
  readonly order: number;
  readonly title: string;
  readonly loadComponent: () => Promise<Type<unknown>>;
}

/// Inputs every section component can declare (`input.required<string>()` for each it needs).
export interface TicketDetailSectionInputs {
  ticketKey: string;
  ticketId: string;
  projectKey: string;
}

export const TICKET_DETAIL_SECTIONS = new InjectionToken<readonly TicketDetailSection[]>(
  'TICKET_DETAIL_SECTIONS',
  {
    factory: () => [],
  },
);

/// Registers a ticket view section. Call it in `app.config.ts` (or any environment injector) of the
/// contributing feature: `provideTicketDetailSection({ id: 'test-cases', order: 10, title: 'Test cases', loadComponent: () => import(...).then(m => m.X) })`.
export function provideTicketDetailSection(
  section: TicketDetailSection,
): ReturnType<typeof makeEnvironmentProviders> {
  const provider: Provider = { provide: TICKET_DETAIL_SECTIONS, useValue: section, multi: true };
  return makeEnvironmentProviders([provider]);
}
