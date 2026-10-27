import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { TicketCreator } from '@core/tickets/create-ticket';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { docsHomeUrl } from '@core/docs/doc-links';
import {
  assigneeItems,
  priorityItems,
  recentDocRows,
  severityItems,
  sum,
  typeItems,
} from './dashboard-widgets';
import { DashboardLinks } from './dashboard-links';
import { ProjectDashboard } from './dashboard.model';
import { DashboardStore } from './dashboard.store';
import { BarListComponent } from './widgets/bar-list.component';
import { CreatedResolvedChartComponent } from './widgets/created-resolved-chart.component';
import { DashboardCardComponent } from './widgets/dashboard-card.component';
import { EpicProgressComponent } from './widgets/epic-progress.component';
import { KpiTilesComponent } from './widgets/kpi-tiles.component';
import { RecentDocsComponent } from './widgets/recent-docs.component';
import { RegressionsWidgetComponent } from './widgets/regressions-widget.component';
import { StatusDistributionComponent } from './widgets/status-distribution.component';
import { TestCasesWidgetComponent } from './widgets/test-cases-widget.component';
import { DashboardTicketListComponent } from './widgets/ticket-list.component';
import { VersionFilterComponent } from './widgets/version-filter.component';

/// Project dashboard (spec §7, layout-and-screens §3.5): KPI row, then the widget grid. The
/// version filter lives in the URL (`?version=`), so a filtered dashboard can be shared.
@Component({
  selector: 'tk-dashboard-view',
  imports: [
    RouterLink,
    MatButtonModule,
    RelativeTimePipe,
    EmptyStateComponent,
    KbdComponent,
    BarListComponent,
    CreatedResolvedChartComponent,
    DashboardCardComponent,
    DashboardTicketListComponent,
    EpicProgressComponent,
    KpiTilesComponent,
    RecentDocsComponent,
    RegressionsWidgetComponent,
    StatusDistributionComponent,
    TestCasesWidgetComponent,
    VersionFilterComponent,
  ],
  providers: [DashboardStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-project.dashboard' },
  templateUrl: './dashboard.view.html',
  styleUrl: './dashboard.view.scss',
})
export class DashboardView {
  protected readonly store = inject(DashboardStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly creator = inject(TicketCreator);

  readonly projectKey = input.required<string>();
  readonly version = input<string | undefined>();

  protected readonly versionFilter = computed(() => this.version()?.trim() || null);
  protected readonly types = computed(() => this.map(typeItems));
  protected readonly priorities = computed(() => this.map(priorityItems));
  protected readonly severities = computed(() => this.map(severityItems));
  protected readonly assignees = computed(() => this.map(assigneeItems));
  protected readonly openBugs = computed(() => sum(this.severities()));
  protected readonly recentDocs = computed(() => {
    const data = this.store.data();
    return data ? recentDocRows(data) : [];
  });
  protected readonly docsHome = computed(() => docsHomeUrl(this.store.projectKey()));
  protected readonly versionNote = computed(() =>
    this.versionFilter() === null ? null : 'All versions',
  );

  constructor() {
    effect(() => this.store.load(this.projectKey(), this.versionFilter()));
    prefetchChartOnIdle(inject(DestroyRef));
  }

  protected setVersion(version: string | null): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { version },
      queryParamsHandling: 'merge',
    });
  }

  protected createTicket(): void {
    void this.creator.open({ projectKey: this.store.projectKey() });
  }

  private map<T>(mapper: (data: ProjectDashboard, links: DashboardLinks) => T[]): T[] {
    const data = this.store.data();
    return data ? mapper(data, this.store.links()) : [];
  }
}

/// Loads the chart chunk (Chart.js) while the dashboard data is still on its way, so the deferred
/// "Created vs resolved" chart renders as soon as the data arrives instead of after a second fetch.
function prefetchChartOnIdle(destroyRef: DestroyRef): void {
  const load = () => void import('./widgets/created-resolved-chart.component');
  if (typeof requestIdleCallback === 'function') {
    const handle = requestIdleCallback(load, { timeout: 1500 });
    destroyRef.onDestroy(() => cancelIdleCallback(handle));
  } else {
    const handle = setTimeout(load, 200);
    destroyRef.onDestroy(() => clearTimeout(handle));
  }
}
