import { computed, inject, Injectable } from '@angular/core';
import { ProjectContext } from '@core/projects/project-context';
import { RouteTab } from '@shared/ui/route-tabs/route-tabs.component';

/// Tabs of project settings. Agent appears only while agent delegation is available to the caller
/// (`project.agent` is null while the flag is off or the instance has no public URL).
@Injectable()
export class ProjectSettingsLayoutStore {
  private readonly context = inject(ProjectContext);

  readonly tabs = computed<readonly RouteTab[]>(() => [
    { path: '', label: 'General', exact: true },
    ...(this.context.project()?.agent ? [{ path: 'agent', label: 'Agent' }] : []),
  ]);
}
