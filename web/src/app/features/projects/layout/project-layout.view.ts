import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink, RouterOutlet } from '@angular/router';
import { ProjectContext } from '@core/projects/project-context';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { RouteTab, RouteTabsComponent } from '@shared/ui/route-tabs/route-tabs.component';

const TABS: readonly RouteTab[] = [
  { path: 'dashboard', label: 'Dashboard' },
  { path: 'backlog', label: 'Backlog' },
  { path: 'test-cases', label: 'Test cases' },
  { path: 'regressions', label: 'Regressions' },
  { path: 'settings', label: 'Settings' },
];

@Component({
  selector: 'tk-project-layout-view',
  imports: [
    RouterOutlet,
    RouterLink,
    MatButtonModule,
    MatTooltip,
    ProjectTileComponent,
    IconComponent,
    EmptyStateComponent,
    RouteTabsComponent,
  ],
  providers: [ProjectContext],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-project.layout' },
  template: `
    @if (store.notFound()) {
      <tk-empty-state
        icon="tablerFolders"
        [title]="notFoundTitle()"
        description="Check the key, or ask a project owner to add you."
      >
        <a mat-stroked-button routerLink="/projects">All projects</a>
      </tk-empty-state>
    } @else {
      <header class="head">
        <tk-project-tile [projectKey]="store.projectKey()" />
        <h1>{{ store.name() }}</h1>
        @if (store.visibility(); as visibility) {
          <tk-icon
            class="visibility"
            [name]="visibility === 'Private' ? 'tablerLock' : 'tablerWorld'"
            [size]="14"
            [matTooltip]="visibility"
          />
        }
      </header>
      <tk-route-tabs [tabs]="tabs" ariaLabel="Project sections" testIdPrefix="project-tab-">
        <router-outlet />
      </tk-route-tabs>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 14px 24px 0;
    }
    h1 {
      margin: 0;
      font-size: var(--tk-text-lg);
      line-height: var(--tk-leading-lg);
      font-weight: var(--tk-weight-semibold);
    }
    .visibility {
      color: var(--tk-text-subtle);
    }
  `,
})
export class ProjectLayoutView {
  protected readonly store = inject(ProjectContext);
  protected readonly tabs = TABS;

  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => void this.store.load(this.projectKey()));
  }

  protected notFoundTitle(): string {
    return `${this.projectKey().toUpperCase()} doesn't exist or you don't have access`;
  }
}
