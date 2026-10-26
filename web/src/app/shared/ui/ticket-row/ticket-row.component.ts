import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Priority, PRIORITY_LABELS, Severity, TICKET_STATUS_LABELS, TicketStatus, TicketType } from '../../domain/enums';
import { AbsoluteTimePipe, RelativeTimePipe } from '../../pipes/relative-time.pipe';
import { AvatarComponent } from '../domain/avatar.component';
import { SeverityBadgeComponent } from '../domain/domain-badges';
import { LabelChipComponent } from '../domain/label-chip.component';
import { PriorityIconComponent } from '../domain/priority-icon.component';
import { StatusBadgeComponent } from '../domain/status-badge.component';
import { TypeIconComponent } from '../domain/type-icon.component';

/// The fields a read-only ticket row shows; the API's ticket summary satisfies it.
export interface TicketRowData {
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  severity: Severity | null;
  labels: readonly string[];
  assignee: { id: string; displayName: string } | null;
  updatedAt: string;
}

/// Dense read-only ticket row for cross-project lists (search results, My work): priority, key,
/// type, title, severity, labels, status, assignee and updated date. Selection and opening are the
/// host list's job (`focused` draws the keyboard cursor).
@Component({
  selector: 'tk-ticket-row',
  imports: [
    AbsoluteTimePipe,
    RelativeTimePipe,
    AvatarComponent,
    SeverityBadgeComponent,
    LabelChipComponent,
    PriorityIconComponent,
    StatusBadgeComponent,
    TypeIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'row',
    '[class.focus]': 'focused()',
    '[class.done]': 'ticket().status === "Done"',
    '[attr.aria-selected]': 'focused()',
    '[attr.data-testid]': 'testIdPrefix() + ticket().key',
  },
  template: `
    <tk-priority-icon role="gridcell" [priority]="ticket().priority" [attr.aria-label]="'Priority: ' + priorityLabel()" />
    <span class="key tnum" role="gridcell">{{ ticket().key }}</span>
    <tk-type-icon [type]="ticket().type" [size]="14" />
    <span class="title" role="gridcell" data-testid="row-title">{{ ticket().title }}</span>
    @if (ticket().severity === 'Blocker' || ticket().severity === 'Critical' || ticket().severity === 'Major') {
      <tk-severity-badge [severity]="ticket().severity!" />
    }
    <span class="fill"></span>
    <span class="labels">
      @for (label of shownLabels(); track label) {
        <tk-label-chip [label]="label" />
      }
      @if (ticket().labels.length > 2) {
        <span class="more">+{{ ticket().labels.length - 2 }}</span>
      }
    </span>
    <span class="status" role="gridcell"><tk-status-badge [status]="ticket().status" [attr.aria-label]="statusLabel()" /></span>
    <tk-avatar [userId]="ticket().assignee?.id" [name]="ticket().assignee?.displayName" [showTitle]="true" />
    <span class="date" role="gridcell" [title]="ticket().updatedAt | absoluteTime">{{ ticket().updatedAt | relativeTime }}</span>
  `,
  styles: `
    :host {
      height: var(--tk-row-h);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 16px 0 14px;
      border-bottom: 1px solid var(--tk-border-subtle);
      position: relative;
      background: var(--tk-bg);
      cursor: pointer;
      user-select: none;
    }
    :host:hover,
    :host(.focus) {
      background: var(--tk-bg-hover);
    }
    :host(.focus)::before {
      content: '';
      position: absolute;
      left: 0;
      top: -1px;
      bottom: 0;
      width: 2px;
      background: var(--tk-accent);
    }
    :host(.done) .title {
      color: var(--tk-text-muted);
    }
    .key {
      width: 96px;
      flex: none;
      color: var(--tk-text-muted);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .title {
      min-width: 0;
      flex: 0 1 auto;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--tk-text);
    }
    .fill {
      flex: 1 1 0;
      min-width: 12px;
    }
    .labels {
      display: flex;
      gap: 4px;
      align-items: center;
      flex: none;
    }
    .more {
      font-size: var(--tk-text-xs);
      color: var(--tk-text-subtle);
      font-weight: var(--tk-weight-medium);
    }
    .status {
      width: 128px;
      flex: none;
      display: flex;
    }
    @container (max-width: 980px) {
      .labels {
        display: none;
      }
    }
    @container (max-width: 720px) {
      .status,
      .date {
        display: none;
      }
    }
    .date {
      width: 52px;
      flex: none;
      text-align: right;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
  `,
})
export class TicketRowComponent {
  readonly ticket = input.required<TicketRowData>();
  readonly focused = input(false);
  /// `data-testid` is this prefix plus the ticket key.
  readonly testIdPrefix = input('ticket-row-');

  protected readonly shownLabels = computed(() => this.ticket().labels.slice(0, 2));
  protected readonly statusLabel = computed(() => TICKET_STATUS_LABELS[this.ticket().status]);
  protected readonly priorityLabel = computed(() => PRIORITY_LABELS[this.ticket().priority]);
}
