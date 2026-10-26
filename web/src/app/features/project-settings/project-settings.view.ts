import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { DangerZoneComponent } from './danger-zone.component';
import { GeneralSettingsComponent } from './general-settings.component';
import { MembersSettingsComponent } from './members-settings.component';
import { ProjectSettingsStore } from './project-settings.store';

/// Project settings tab: general fields, members and the danger zone. The project itself is loaded
/// by the project layout (ProjectContext).
@Component({
  selector: 'tk-project-settings-view',
  imports: [
    GeneralSettingsComponent,
    MembersSettingsComponent,
    DangerZoneComponent,
    SkeletonRowsComponent,
  ],
  providers: [ProjectSettingsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-project.settings' },
  template: `
    @if (store.project()) {
      <div class="body">
        <tk-general-settings />
        <tk-members-settings />
        <tk-danger-zone />
      </div>
    } @else {
      <tk-skeleton-rows [count]="8" />
    }
  `,
  styles: `
    .body {
      max-width: 880px;
      padding: 20px 24px 64px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
  `,
})
export class ProjectSettingsView {
  protected readonly store = inject(ProjectSettingsStore);
  readonly projectKey = input.required<string>();
}
