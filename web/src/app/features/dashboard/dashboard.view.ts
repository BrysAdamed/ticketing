import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { DashboardStore } from './dashboard.store';

@Component({
  selector: 'tk-dashboard-view',
  imports: [PagePlaceholderComponent],
  providers: [DashboardStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-project.dashboard' },
  template: `
    <header class="tk-page-header">
      <h1>Dashboard</h1>
    </header>
    <tk-page-placeholder
      icon="tablerChartBar"
      title="Dashboard"
      viewId="project.dashboard"
      description="Project KPIs and charts."
    />
  `,
})
export class DashboardView {
  protected readonly store = inject(DashboardStore);
  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ projectKey: this.projectKey() });
    });
  }
}
