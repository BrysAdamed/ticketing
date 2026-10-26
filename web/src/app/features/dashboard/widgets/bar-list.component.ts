import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Priority, Severity, TicketStatus, TicketType } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { SeverityBadgeComponent } from '@shared/ui/domain/domain-badges';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DashboardLink } from '../dashboard-links';

export type BarLead =
  | { kind: 'type'; type: TicketType }
  | { kind: 'status'; status: TicketStatus }
  | { kind: 'priority'; priority: Priority }
  | { kind: 'severity'; severity: Severity | null }
  | { kind: 'avatar'; userId: string | null; name: string | null }
  | { kind: 'icon'; icon: string };

export interface BarItem {
  id: string;
  label: string;
  count: number;
  /// CSS colour of the bar, a design token such as `var(--tk-type-bug)`.
  color: string;
  lead: BarLead;
  link: DashboardLink | null;
  muted?: boolean;
}

/// Compact horizontal bar list for small categorical counts: identity comes from the leading
/// glyph and the label, length from the bar, the exact value from the count (which links to the
/// search that produces it). Bars share one scale, the widget's largest count.
@Component({
  selector: 'tk-bar-list',
  imports: [
    RouterLink,
    DecimalPipe,
    AvatarComponent,
    IconComponent,
    PriorityIconComponent,
    SeverityBadgeComponent,
    StatusIconComponent,
    TypeIconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ul [attr.aria-label]="label()">
      @for (item of rows(); track item.id) {
        <li [class.muted]="item.muted" [attr.data-testid]="testIdPrefix() + item.id">
          <span class="lead">
            @switch (item.lead.kind) {
              @case ('type') {
                <tk-type-icon [type]="$any(item.lead).type" />
              }
              @case ('status') {
                <tk-status-icon [status]="$any(item.lead).status" />
              }
              @case ('priority') {
                <tk-priority-icon [priority]="$any(item.lead).priority" [showTitle]="false" />
              }
              @case ('avatar') {
                <tk-avatar
                  [userId]="$any(item.lead).userId"
                  [name]="$any(item.lead).name"
                  [showTitle]="false"
                />
              }
              @case ('icon') {
                <tk-icon [name]="$any(item.lead).icon" [size]="14" />
              }
            }
          </span>
          <span class="label" [title]="item.label">
            @if (item.lead.kind === 'severity' && $any(item.lead).severity) {
              <tk-severity-badge [severity]="$any(item.lead).severity" />
            } @else {
              {{ item.label }}
            }
          </span>
          <span class="track">
            @if (item.count > 0) {
              <span class="bar" [style.width.%]="item.share" [style.background]="item.color"></span>
            }
          </span>
          @if (item.link && item.count > 0) {
            <a
              class="count"
              [routerLink]="item.link.path"
              [queryParams]="item.link.query"
              [attr.aria-label]="item.count + ' ' + item.label + ', open in search'"
              data-testid="dashboard-count"
              >{{ item.count | number }}</a
            >
          } @else {
            <span class="count zero">{{ item.count | number }}</span>
          }
        </li>
      }
    </ul>
  `,
  styles: `
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      height: 28px;
      display: grid;
      grid-template-columns: 20px minmax(88px, 1.1fr) minmax(48px, 1.2fr) 44px;
      align-items: center;
      gap: 8px;
    }
    .lead {
      display: inline-flex;
      justify-content: center;
    }
    .label {
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
      color: var(--tk-text);
    }
    li.muted .label {
      color: var(--tk-text-muted);
    }
    .track {
      height: 10px;
      display: flex;
      align-items: center;
    }
    .bar {
      display: block;
      height: 10px;
      min-width: 3px;
      border-radius: 0 var(--tk-radius-sm) var(--tk-radius-sm) 0;
    }
    .count {
      justify-self: end;
      font-variant-numeric: tabular-nums;
      color: var(--tk-text);
      text-decoration: none;
      border-radius: var(--tk-radius-xs);
      padding: 0 2px;
    }
    a.count:hover {
      color: var(--tk-accent-fg);
      text-decoration: underline;
    }
    a.count:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: 1px;
    }
    .count.zero {
      color: var(--tk-text-subtle);
    }
  `,
})
export class BarListComponent {
  readonly items = input.required<readonly BarItem[]>();
  readonly label = input.required<string>();
  readonly testIdPrefix = input('');

  protected readonly rows = computed(() => {
    const items = this.items();
    const max = Math.max(1, ...items.map((i) => i.count));
    return items.map((item) => ({ ...item, share: (item.count / max) * 100 }));
  });
}
