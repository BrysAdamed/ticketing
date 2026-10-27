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
import { TICKET_DETAIL_SECTIONS, TicketDetailSection } from '@core/tickets/ticket-sections';

interface LoadedSection {
  section: TicketDetailSection;
  component: Type<unknown> | null;
  failed: boolean;
}

/// Renders the sections other features contributed through `TICKET_DETAIL_SECTIONS` (test cases,
/// attachments, …), each lazily loaded and given `ticketKey`, `ticketId` and `projectKey`.
@Component({
  selector: 'tk-ticket-sections-host',
  imports: [NgComponentOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (entry of sections(); track entry.section.id) {
      <section
        class="contributed"
        [attr.data-testid]="'ticket-section-' + entry.section.id"
        [attr.aria-label]="entry.section.title"
      >
        @if (entry.component; as component) {
          <ng-container [ngComponentOutlet]="component" [ngComponentOutletInputs]="inputs()" />
        } @else if (entry.failed) {
          <p class="failed">{{ entry.section.title }} couldn't be loaded.</p>
        }
      </section>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .contributed {
      margin-top: 28px;
    }
    .failed {
      color: var(--tk-text-subtle);
    }
  `,
})
export class TicketSectionsHostComponent {
  readonly ticketKey = input.required<string>();
  readonly ticketId = input.required<string>();
  readonly projectKey = input.required<string>();

  protected readonly inputs = computed(() => ({
    ticketKey: this.ticketKey(),
    ticketId: this.ticketId(),
    projectKey: this.projectKey(),
  }));
  protected readonly sections = signal<LoadedSection[]>([]);

  constructor() {
    const registered = [...inject(TICKET_DETAIL_SECTIONS)].sort((a, b) => a.order - b.order);
    this.sections.set(registered.map((section) => ({ section, component: null, failed: false })));
    for (const section of registered) {
      section
        .loadComponent()
        .then((component) => this.update(section.id, { component }))
        .catch(() => this.update(section.id, { failed: true }));
    }
  }

  private update(id: string, change: Partial<LoadedSection>): void {
    this.sections.update((list) =>
      list.map((s) => (s.section.id === id ? { ...s, ...change } : s)),
    );
  }
}
