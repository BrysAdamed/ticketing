import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TICKET_STATUS_LABELS, TicketStatus } from '@shared/domain/enums';

const PIES: Partial<Record<TicketStatus, string>> = {
  InProgress: 'M7 7 7 3.5A3.5 3.5 0 0 1 10.5 7Z',
  Review: 'M7 7 7 3.5A3.5 3.5 0 0 1 7 10.5Z',
  ReadyForTesting: 'M7 7 7 3.5A3.5 3.5 0 1 1 4.525 9.475Z',
  Testing: 'M7 7 7 3.5A3.5 3.5 0 1 1 3.5 7Z',
  ReadyForDeploy: 'M7 7 7 3.5A3.5 3.5 0 1 1 4.525 4.525Z',
};

/// Status progress ring (design-system §8): the filled fraction shows pipeline progress.
@Component({
  selector: 'tk-status-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': '"Status: " + label()',
    '[style.color]': 'color()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
  },
  template: `
    <svg viewBox="0 0 14 14" [attr.width]="size()" [attr.height]="size()">
      @switch (status()) {
        @case ('Done') {
          <circle cx="7" cy="7" r="6.5" fill="currentColor" />
          <path
            d="M4.4 7.2 6.2 9l3.4-3.6"
            fill="none"
            stroke="#fff"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        }
        @case ('OnHold') {
          <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5" />
          <path
            d="M5.6 4.9v4.2M8.4 4.9v4.2"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
          />
        }
        @default {
          <circle cx="7" cy="7" r="5.75" fill="none" stroke="currentColor" stroke-width="1.5" />
          @if (pie(); as d) {
            <path [attr.d]="d" fill="currentColor" />
          }
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class StatusIconComponent {
  readonly status = input.required<TicketStatus>();
  readonly size = input(14);

  protected readonly label = computed(() => TICKET_STATUS_LABELS[this.status()]);
  protected readonly pie = computed(() => PIES[this.status()] ?? null);
  protected readonly color = computed(() => `var(--tk-status-${this.status().toLowerCase()})`);
}
