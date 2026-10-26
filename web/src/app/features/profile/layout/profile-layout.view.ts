import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RouteTab, RouteTabsComponent } from '@shared/ui/route-tabs/route-tabs.component';
import { ProfileLayoutStore } from './profile-layout.store';

const TABS: readonly RouteTab[] = [
  { path: '', label: 'Profile', exact: true },
  { path: 'tokens', label: 'Access tokens' },
];

@Component({
  selector: 'tk-profile-layout-view',
  imports: [RouterOutlet, RouteTabsComponent],
  providers: [ProfileLayoutStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-profile.layout' },
  template: `
    <header class="tk-page-header">
      <h1>{{ store.title }}</h1>
    </header>
    <tk-route-tabs [tabs]="tabs" ariaLabel="Profile sections" testIdPrefix="profile-tab-">
      <router-outlet />
    </tk-route-tabs>
  `,
})
export class ProfileLayoutView {
  protected readonly store = inject(ProfileLayoutStore);
  protected readonly tabs = TABS;
}
