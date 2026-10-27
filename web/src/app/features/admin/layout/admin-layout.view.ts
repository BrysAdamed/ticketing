import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RouteTabsComponent } from '@shared/ui/route-tabs/route-tabs.component';
import { AdminLayoutStore } from './admin-layout.store';

@Component({
  selector: 'tk-admin-layout-view',
  imports: [RouterOutlet, RouteTabsComponent],
  providers: [AdminLayoutStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-admin.layout' },
  template: `
    <header class="tk-page-header">
      <h1>{{ store.title }}</h1>
    </header>
    <tk-route-tabs [tabs]="store.tabs()" ariaLabel="Admin sections" testIdPrefix="admin-tab-">
      <router-outlet />
    </tk-route-tabs>
  `,
})
export class AdminLayoutView {
  protected readonly store = inject(AdminLayoutStore);
}
