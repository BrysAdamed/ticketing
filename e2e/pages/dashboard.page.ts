import { expect, Locator, Page } from '@playwright/test';

/// Project dashboard (`/projects/:key/dashboard`): KPI tiles, widget counts and the version filter.
export class DashboardPage {
  readonly view: Locator;
  readonly grid: Locator;
  readonly versionFilter: Locator;

  constructor(private readonly page: Page) {
    this.view = page.getByTestId('view-project.dashboard');
    this.grid = page.getByTestId('dashboard-grid');
    this.versionFilter = page.getByTestId('dashboard-version-filter');
  }

  async goto(projectKey: string, version?: string): Promise<void> {
    const query = version ? `?version=${encodeURIComponent(version)}` : '';
    await this.page.goto(`/projects/${projectKey}/dashboard${query}`);
    await expect(this.grid).toBeVisible();
  }

  kpi(id: 'open' | 'done' | 'points' | 'unassigned'): Locator {
    return this.page.getByTestId(`kpi-${id}`);
  }

  kpiValue(id: 'open' | 'done' | 'points' | 'unassigned'): Locator {
    return this.kpi(id).getByTestId('kpi-value');
  }

  /// The count cell of one bar-list row, for example `count('status-', 'InProgress')`.
  count(prefix: string, id: string): Locator {
    return this.page.getByTestId(`${prefix}${id}`).locator('.count');
  }

  async pickVersion(label: string): Promise<void> {
    await this.versionFilter.click();
    await this.page.getByRole('option', { name: label }).click();
  }
}
