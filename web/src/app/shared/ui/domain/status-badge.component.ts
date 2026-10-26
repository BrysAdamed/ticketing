import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { statusCategory, TICKET_STATUS_LABELS, TicketStatus } from '@shared/domain/enums';
import { StatusIconComponent } from './status-icon.component';

/// Status ring + label. `tinted` renders it as a badge on the status category tint.
@Component({
  selector: 'tk-status-badge',
  imports: [StatusIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.tinted]': 'tinted()',
    '[attr.data-category]': 'category()',
    '[attr.data-status]': 'status()',
  },
  template: `<tk-status-icon [status]="status()" /><span>{{ label() }}</span>`,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
      font-weight: var(--tk-weight-medium);
    }
    :host(.tinted) {
      height: 20px;
      padding: 0 6px;
      gap: 4px;
      border-radius: var(--tk-radius-sm);
      font-size: var(--tk-text-xs);
    }
    :host(.tinted[data-category='ToDo']) {
      background: var(--tk-gray-bg);
      color: var(--tk-gray-fg);
    }
    :host(.tinted[data-category='InProgress']) {
      background: var(--tk-blue-bg);
      color: var(--tk-blue-fg);
    }
    :host(.tinted[data-category='Done']) {
      background: var(--tk-green-bg);
      color: var(--tk-green-fg);
    }
  `,
})
export class StatusBadgeComponent {
  readonly status = input.required<TicketStatus>();
  readonly tinted = input(false);

  protected readonly label = computed(() => TICKET_STATUS_LABELS[this.status()]);
  protected readonly category = computed(() => statusCategory(this.status()));
}
