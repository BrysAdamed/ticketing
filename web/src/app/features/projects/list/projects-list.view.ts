import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerArchive, tablerArchiveOff } from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { CommandRegistry } from '@core/commands/command-registry';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ProjectDetail } from '@core/projects/project-context';
import { ProjectSummary } from '@core/projects/project-directory';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { NewProjectDialog } from './new-project.dialog';
import { ProjectProgressComponent } from './project-progress.component';
import { plainPreview, ProjectFilter, ProjectsListStore } from './projects-list.store';

@Component({
  selector: 'tk-projects-list-view',
  imports: [
    TourAnchorDirective,
    RouterLink,
    MatButtonModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTooltip,
    IconComponent,
    AvatarComponent,
    BadgeComponent,
    KbdComponent,
    ProjectTileComponent,
    ProjectProgressComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    RelativeTimePipe,
  ],
  providers: [ProjectsListStore],
  viewProviders: [provideIcons({ tablerArchive, tablerArchiveOff })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-projects.list' },
  templateUrl: './projects-list.view.html',
  styleUrl: './projects-list.view.scss',
})
export class ProjectsListView {
  protected readonly store = inject(ProjectsListStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly auth = inject(AuthService);

  protected readonly filterOptions = computed<SegmentOption<ProjectFilter>[]>(() => {
    const counts = this.store.counts();
    return [
      { value: 'all', label: 'All', count: counts.all },
      { value: 'mine', label: 'Mine', count: counts.mine },
      { value: 'public', label: 'Public', count: counts.public },
      { value: 'private', label: 'Private', count: counts.private },
    ];
  });

  constructor() {
    void this.store.load();
    const destroyRef = inject(DestroyRef);
    inject(CommandRegistry).registerCommands(
      [
        {
          id: 'project.create',
          label: 'Create project',
          group: 'Projects',
          icon: 'tablerPlus',
          shortcut: 'N',
          run: () => void this.createProject(),
        },
      ],
      destroyRef,
    );
    inject(ShortcutService).registerScoped(
      [
        {
          keys: 'n',
          description: 'New project',
          section: 'Projects',
          handler: () => void this.createProject(),
        },
        {
          keys: '/',
          description: 'Filter projects',
          section: 'Projects',
          handler: (event) => {
            event.preventDefault();
            document.querySelector<HTMLInputElement>('[data-testid="projects-filter"]')?.focus();
          },
        },
      ],
      destroyRef,
    );
  }

  protected preview(project: ProjectSummary): string {
    return plainPreview(project.descriptionPreview);
  }

  protected async createProject(): Promise<void> {
    const ref = this.dialog.open<NewProjectDialog, void, ProjectDetail>(NewProjectDialog, {
      width: '520px',
      autoFocus: 'first-tabbable',
    });
    const project = await firstValueFrom(ref.afterClosed());
    if (!project) return;
    await this.store.changed();
    this.toast.success(`Project ${project.key} created.`);
    await this.router.navigate(['/projects', project.key]);
  }

  protected async archive(project: ProjectSummary): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Archive ${project.name}?`,
      message:
        'The project becomes read-only for everyone. Its tickets on boards go back to the backlog and it is unlinked from every board. You can unarchive it later.',
      confirmLabel: 'Archive project',
      danger: true,
    });
    if (!confirmed) return;
    try {
      await this.store.archive(project);
      this.toast.success(`${project.key} archived.`);
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async unarchive(project: ProjectSummary): Promise<void> {
    try {
      await this.store.unarchive(project);
      this.toast.success(`${project.key} unarchived.`);
    } catch (error) {
      this.toast.error(error);
    }
  }
}
