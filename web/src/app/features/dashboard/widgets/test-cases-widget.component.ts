import { DecimalPipe, PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TestCaseStatusBadgeComponent } from '@shared/ui/domain/domain-badges';
import { DashboardLinks } from '../dashboard-links';
import { ProjectDashboard } from '../dashboard.model';

/// Widget 10: non-archived test cases per status as one stacked bar in the test case status
/// colours, plus the automation ratio as a meter (Automatic / (Manual + Automatic)).
@Component({
  selector: 'tk-test-cases-widget',
  imports: [RouterLink, DecimalPipe, PercentPipe, TestCaseStatusBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ratio">
      <span class="figure" data-testid="automation-ratio">
        {{ stats().automationRatio === null ? '–' : (stats().automationRatio | percent: '1.0-0') }}
      </span>
      <span class="caption">automated<br /><span class="muted">of Manual + Automatic</span></span>
    </div>
    <span class="meter" role="img" [attr.aria-label]="'Automation ratio ' + ratioLabel()">
      <span class="fill" [style.width.%]="(stats().automationRatio ?? 0) * 100"></span>
    </span>
    <div class="stack" aria-hidden="true">
      @for (row of rows(); track row.status) {
        @if (row.count > 0) {
          <span [style.flex-grow]="row.count" [style.background]="row.color"></span>
        }
      }
    </div>
    <ul>
      @for (row of rows(); track row.status) {
        <li>
          <tk-test-case-status-badge [status]="row.status" />
          <a
            [routerLink]="links().testCases(row.status).path"
            [queryParams]="links().testCases(row.status).query"
            [attr.data-testid]="'test-cases-' + row.status"
            >{{ row.count | number }}</a
          >
        </li>
      }
      <li class="total">
        <span>Total</span>
        <a [routerLink]="links().testCases().path">{{ stats().total | number }}</a>
      </li>
    </ul>
  `,
  styles: `
    :host {
      display: block;
    }
    .ratio {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .figure {
      font-size: var(--tk-text-3xl);
      line-height: var(--tk-leading-3xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
    }
    .caption {
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
      color: var(--tk-text-muted);
    }
    .muted {
      color: var(--tk-text-subtle);
    }
    .meter {
      display: block;
      height: 6px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-teal-bg);
      overflow: hidden;
      margin-bottom: 16px;
    }
    .fill {
      display: block;
      height: 100%;
      border-radius: var(--tk-radius-full);
      background: var(--tk-testcase-automatic);
    }
    .stack {
      display: flex;
      gap: 2px;
      height: 8px;
      margin-bottom: 8px;
    }
    .stack span {
      min-width: 4px;
      flex-basis: 0;
    }
    .stack span:first-child {
      border-radius: var(--tk-radius-full) 0 0 var(--tk-radius-full);
    }
    .stack span:last-child {
      border-radius: 0 var(--tk-radius-full) var(--tk-radius-full) 0;
    }
    .stack span:only-child {
      border-radius: var(--tk-radius-full);
    }
    ul {
      list-style: none;
      margin: 0;
      padding: 0;
    }
    li {
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    li.total {
      border-top: 1px solid var(--tk-border-subtle);
      color: var(--tk-text-muted);
    }
    a {
      color: var(--tk-text);
      text-decoration: none;
      font-variant-numeric: tabular-nums;
    }
    a:hover {
      color: var(--tk-accent-fg);
      text-decoration: underline;
    }
  `,
})
export class TestCasesWidgetComponent {
  readonly stats = input.required<ProjectDashboard['testCases']>();
  readonly links = input.required<DashboardLinks>();

  protected readonly rows = computed(() =>
    this.stats().byStatus.map((s) => ({
      ...s,
      color: `var(--tk-testcase-${s.status.toLowerCase()})`,
    })),
  );

  protected readonly ratioLabel = computed(() => {
    const ratio = this.stats().automationRatio;
    return ratio === null ? 'not available' : `${Math.round(ratio * 100)}%`;
  });
}
