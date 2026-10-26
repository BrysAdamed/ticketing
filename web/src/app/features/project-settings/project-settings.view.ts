import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { ProjectSettingsStore } from './project-settings.store';

@Component({
  selector: 'tk-project-settings-view',
  imports: [PagePlaceholderComponent],
  providers: [ProjectSettingsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-project.settings' },
  template: `
    <header class="tk-page-header">
      <h1>Settings</h1>
    </header>
    <tk-page-placeholder
      icon="tablerAdjustmentsHorizontal"
      title="Settings"
      viewId="project.settings"
      description="Name, description, visibility and members."
    />
  `,
})
export class ProjectSettingsView {
  protected readonly store = inject(ProjectSettingsStore);
  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ projectKey: this.projectKey() });
    });
  }
}
