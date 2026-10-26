import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { DashboardLinks } from '../dashboard-links';
import { ProjectDashboard } from '../dashboard.model';
import { categorySegments, statusItems } from '../dashboard-widgets';
import { BarListComponent } from './bar-list.component';

/// Widget 2: part-to-whole by status category (100% stacked bar, 2px surface gaps) over the
/// per-status breakdown of all eight statuses, zeros included.
@Component({
  selector: 'tk-status-distribution',
  imports: [BarListComponent, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="stack" role="img" [attr.aria-label]="summary()">
      @for (segment of segments(); track segment.category) {
        @if (segment.count > 0) {
          <span
            class="segment"
            [style.flex-grow]="segment.share"
            [style.background]="segment.color"
            [title]="segment.label + ': ' + segment.count"
          ></span>
        }
      }
      @if (total() === 0) {
        <span class="segment empty"></span>
      }
    </div>
    <ul class="legend">
      @for (segment of segments(); track segment.category) {
        <li>
          <span class="key" [style.background]="segment.color"></span>
          {{ segment.label }}
          <strong>{{ segment.count | number }}</strong>
          @if (total() > 0) {
            <span class="share">{{ segment.share | number: '1.0-0' }}%</span>
          }
        </li>
      }
    </ul>
    <tk-bar-list [items]="items()" label="Tickets by status" testIdPrefix="status-" />
  `,
  styles: `
    :host {
      display: block;
    }
    .stack {
      display: flex;
      gap: 2px;
      height: 8px;
      margin: 4px 0 10px;
    }
    .segment {
      min-width: 4px;
      flex-basis: 0;
    }
    .segment:first-child {
      border-radius: var(--tk-radius-full) 0 0 var(--tk-radius-full);
    }
    .segment:last-child {
      border-radius: 0 var(--tk-radius-full) var(--tk-radius-full) 0;
    }
    .segment:only-child {
      border-radius: var(--tk-radius-full);
    }
    .segment.empty {
      flex-grow: 1;
      background: var(--tk-bg-muted);
    }
    .legend {
      list-style: none;
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin: 0 0 12px;
      padding: 0;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    .legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .key {
      width: 8px;
      height: 8px;
      border-radius: 2px;
    }
    strong {
      color: var(--tk-text);
      font-weight: var(--tk-weight-medium);
      font-variant-numeric: tabular-nums;
    }
    .share {
      color: var(--tk-text-subtle);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class StatusDistributionComponent {
  readonly data = input.required<ProjectDashboard>();
  readonly links = input.required<DashboardLinks>();

  protected readonly segments = computed(() => categorySegments(this.data()));
  protected readonly items = computed(() => statusItems(this.data(), this.links()));
  protected readonly total = computed(() => this.segments().reduce((sum, s) => sum + s.count, 0));
  protected readonly summary = computed(() =>
    this.segments()
      .map((s) => `${s.label} ${s.count}`)
      .join(', '),
  );
}
