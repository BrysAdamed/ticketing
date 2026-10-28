import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink, RouterOutlet } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerArchive } from '@ng-icons/tabler-icons';
import { ToastService } from '@core/notify/toast.service';
import { ContextualHintComponent } from '@core/onboarding/hints/contextual-hint.component';
import { BOARDS_NOT_RELINKED, ProjectContext } from '@core/projects/project-context';
import { ProjectDirectory } from '@core/projects/project-directory';
import { AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { ProjectLayoutStore } from './project-layout.store';

/// Frame of every project page. Project sections are reached from the sidebar (D-83, backlog.html), so
/// the frame adds only the archived banner. An unknown or inaccessible key renders one project-level
/// not-found state instead of the section, and a failed load an error with Retry.
@Component({
  selector: 'tk-project-layout-view',
  imports: [
    RouterOutlet,
    RouterLink,
    MatButtonModule,
    IconComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    AbsoluteTimePipe,
    ContextualHintComponent,
  ],
  providers: [ProjectContext, ProjectLayoutStore],
  viewProviders: [provideIcons({ tablerArchive })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-project.layout' },
  template: `
    @if (context.notFound()) {
      <tk-empty-state
        icon="tablerFolders"
        data-testid="project-not-found"
        [title]="notFoundTitle()"
        description="Check the key, or ask a project owner to add you."
      >
        <a mat-stroked-button routerLink="/projects">All projects</a>
      </tk-empty-state>
      <tk-contextual-hint class="not-found-hint" hint="hint.private-404" />
    } @else if (context.status() === 'error') {
      <tk-empty-state
        icon="tablerAlertCircle"
        tone="danger"
        data-testid="project-load-error"
        title="Couldn't load the project"
        [description]="context.error()?.title ?? null"
      >
        <button mat-stroked-button type="button" (click)="context.reload()">Retry</button>
      </tk-empty-state>
    } @else if (known()) {
      @if (context.project()?.archivedAt; as archivedAt) {
        <div
          class="tk-callout tk-callout-warning banner"
          role="status"
          data-testid="project-archived-banner"
        >
          <tk-icon name="tablerArchive" [size]="16" />
          <span class="banner-text">
            This project was archived on {{ archivedAt | absoluteTime }} and is read-only. It was
            unlinked from every board and its board tickets went back to the backlog; unarchiving
            does not link the boards again.
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
      <router-outlet />
    } @else {
      <div class="loading"><tk-skeleton-rows [count]="10" /></div>
    }
  `,
  styles: `
    :host {
      display: block;
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
    .loading {
      padding: 56px 0 0;
    }
    .not-found-hint {
      max-width: 480px;
      margin: -32px auto 0;
      padding: 0 16px;
    }
  `,
})
export class ProjectLayoutView {
  protected readonly context = inject(ProjectContext);
  protected readonly layout = inject(ProjectLayoutStore);
  private readonly directory = inject(ProjectDirectory);
  private readonly toast = inject(ToastService);

  readonly projectKey = input.required<string>();

  /// The section renders as soon as the project is known to exist (cached, loaded, or listed in the
  /// sidebar directory), so its own request runs in parallel with the project's.
  protected readonly known = computed(
    () => this.context.project() !== null || !!this.directory.byKey(this.projectKey()),
  );

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => void this.context.load(key));
    });
  }

  protected notFoundTitle(): string {
    return `${this.projectKey().toUpperCase()} doesn't exist or you don't have access`;
  }

  protected async unarchive(): Promise<void> {
    try {
      await this.layout.unarchive();
      this.toast.success(`${this.context.projectKey()} unarchived. ${BOARDS_NOT_RELINKED}`);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
