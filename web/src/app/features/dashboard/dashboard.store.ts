import { Injectable, signal } from '@angular/core';
import { LoadStatus } from '@core/projects/project-directory';

@Injectable()
export class DashboardStore {
  readonly status = signal<LoadStatus>('idle');

  // TODO(dashboard): GET /projects/{key}/stats (spec section 7) and render KPI tiles + Chart.js charts.
  load(_params: { projectKey: string }): void {
    this.status.set('loaded');
  }
}
