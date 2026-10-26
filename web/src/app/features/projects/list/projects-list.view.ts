import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { PROJECT_ROLE_LABELS } from '@shared/domain/enums';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { ProjectFilter, ProjectsListStore } from './projects-list.store';

@Component({
  selector: 'tk-projects-list-view',
  imports: [
    RouterLink,
    MatButtonModule,
    MatTooltip,
    IconComponent,
    ProjectTileComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
  ],
  providers: [ProjectsListStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-projects.list' },
  templateUrl: './projects-list.view.html',
  styleUrl: './projects-list.view.scss',
})
export class ProjectsListView {
  protected readonly store = inject(ProjectsListStore);
  protected readonly roleLabels = PROJECT_ROLE_LABELS;

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
    this.store.load();
  }
}
