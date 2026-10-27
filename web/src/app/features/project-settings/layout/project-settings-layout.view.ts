import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { RouteTabsComponent } from '@shared/ui/route-tabs/route-tabs.component';
import { ProjectSettingsLayoutStore } from './project-settings-layout.store';

@Component({
  selector: 'tk-project-settings-layout-view',
  imports: [RouterOutlet, RouteTabsComponent],
  providers: [ProjectSettingsLayoutStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-project.settings.layout' },
  template: `
    <header class="tk-page-header">
      <h1>Settings</h1>
    </header>
    <tk-route-tabs
      [tabs]="store.tabs()"
      ariaLabel="Project settings sections"
      testIdPrefix="project-settings-tab-"
    >
      <router-outlet />
    </tk-route-tabs>
  `,
})
export class ProjectSettingsLayoutView {
  protected readonly store = inject(ProjectSettingsLayoutStore);
}
