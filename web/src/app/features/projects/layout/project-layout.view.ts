import { ChangeDetectionStrategy, Component, effect, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink, RouterOutlet } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerArchive } from '@ng-icons/tabler-icons';
import { ToastService } from '@core/notify/toast.service';
import { ProjectContext } from '@core/projects/project-context';
import { AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { RouteTab, RouteTabsComponent } from '@shared/ui/route-tabs/route-tabs.component';
import { ProjectLayoutStore } from './project-layout.store';

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
    BadgeComponent,
    IconComponent,
    EmptyStateComponent,
    RouteTabsComponent,
    AbsoluteTimePipe,
  ],
  providers: [ProjectContext, ProjectLayoutStore],
  viewProviders: [provideIcons({ tablerArchive })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-project.layout' },
  template: `
    @if (context.notFound()) {
      <tk-empty-state
        icon="tablerFolders"
        [title]="notFoundTitle()"
        description="Check the key, or ask a project owner to add you."
      >
        <a mat-stroked-button routerLink="/projects">All projects</a>
      </tk-empty-state>
    } @else {
      <header class="head" data-testid="project-header">
        <tk-project-tile [projectKey]="context.projectKey()" />
        <span class="key tnum" data-testid="project-header-key">{{ context.projectKey() }}</span>
        <h1 data-testid="project-header-name">{{ context.name() }}</h1>
        @if (context.visibility(); as visibility) {
          <span
            class="visibility"
            data-testid="project-header-visibility"
            [matTooltip]="
              visibility === 'Private'
                ? 'Only members can see this project'
                : 'Everyone signed in can see and edit this project'
            "
          >
            <tk-icon [name]="visibility === 'Private' ? 'tablerLock' : 'tablerWorld'" [size]="14" />
            {{ visibility }}
          </span>
        }
        @if (context.isArchived()) {
          <tk-badge tone="amber" icon="tablerArchive">Archived</tk-badge>
        }
      </header>
      @if (context.project()?.archivedAt; as archivedAt) {
        <div
          class="tk-callout tk-callout-warning banner"
          role="status"
          data-testid="project-archived-banner"
        >
          <tk-icon name="tablerArchive" [size]="16" />
          <span class="banner-text">
            This project was archived on {{ archivedAt | absoluteTime }} and is read-only.
          </span>
          @if (context.isOwner()) {
            <button
              mat-stroked-button
              type="button"
              class="banner-action"
              data-testid="project-unarchive"
              [disabled]="layout.unarchiving()"
              (click)="unarchive()"
            >
              Unarchive
            </button>
          }
        </div>
      }
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
      min-width: 0;
    }
    .key {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
    }
    h1 {
      margin: 0;
      font-size: var(--tk-text-lg);
      line-height: var(--tk-leading-lg);
      font-weight: var(--tk-weight-semibold);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .visibility {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .banner {
      margin: 10px 24px 0;
      align-items: center;
    }
    .banner-text {
      flex: 1;
    }
    .banner-action {
      height: 24px;
    }
  `,
})
export class ProjectLayoutView {
  protected readonly context = inject(ProjectContext);
  protected readonly layout = inject(ProjectLayoutStore);
  private readonly toast = inject(ToastService);
  protected readonly tabs = TABS;

  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => void this.context.load(this.projectKey()));
  }

  protected notFoundTitle(): string {
    return `${this.projectKey().toUpperCase()} doesn't exist or you don't have access`;
  }

  protected async unarchive(): Promise<void> {
    try {
      await this.layout.unarchive();
      this.toast.success(`${this.context.projectKey()} unarchived.`);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
