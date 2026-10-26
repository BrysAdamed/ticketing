import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { PeekService } from '@core/layout/peek/peek';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { SeverityBadgeComponent } from '@shared/ui/domain/domain-badges';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { DashboardTicket } from '../dashboard.model';

const DAY = 24 * 60 * 60 * 1000;

/// Compact ticket rows (priority, key, type, title, severity, assignee, trailing meta). A row
/// opens the ticket in the peek panel and keeps the dashboard in place.
@Component({
  selector: 'tk-dashboard-ticket-list',
  imports: [
    AvatarComponent,
    PriorityIconComponent,
    SeverityBadgeComponent,
    StatusIconComponent,
    TypeIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul [attr.aria-label]="label()">
      @for (ticket of tickets(); track ticket.key) {
        <li>
          <button
            type="button"
            class="row"
            [attr.data-testid]="'dashboard-ticket-' + ticket.key"
            (click)="peek.open(ticket.key)"
          >
            <tk-priority-icon [priority]="ticket.priority" />
            <span class="key">{{ ticket.key }}</span>
            @if (showType()) {
              <tk-type-icon [type]="ticket.type" [size]="14" />
            }
            <tk-status-icon [status]="ticket.status" />
            <span class="title" [title]="ticket.title">{{ ticket.title }}</span>
            @if (showSeverity() && ticket.severity) {
              <tk-severity-badge [severity]="ticket.severity" />
            }
            <tk-avatar [userId]="ticket.assignee?.id" [name]="ticket.assignee?.displayName" />
            @if (showAge()) {
              <span class="age" [title]="'Last updated ' + ticket.updatedAt">{{
                age(ticket)
              }}</span>
            }
          </button>
        </li>
      }
    </ul>
  `,
  styles: `
    ul {
      list-style: none;
      margin: 0 -8px;
      padding: 0;
    }
    .row {
      width: 100%;
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-sm);
      background: transparent;
      color: var(--tk-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row:hover {
      background: var(--tk-bg-hover);
    }
    .row:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: -2px;
    }
    .key {
      width: 64px;
      flex: none;
      color: var(--tk-text-muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .title {
      flex: 1;
      min-width: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .age {
      width: 36px;
      flex: none;
      text-align: right;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class DashboardTicketListComponent {
  protected readonly peek = inject(PeekService);

  readonly tickets = input.required<readonly DashboardTicket[]>();
  readonly label = input.required<string>();
  readonly showAge = input(false);
  readonly showSeverity = input(false);
  readonly showType = input(true);
  readonly now = input(Date.now());

  protected age(ticket: DashboardTicket): string {
    return `${Math.floor((this.now() - new Date(ticket.updatedAt).getTime()) / DAY)}d`;
  }
}
