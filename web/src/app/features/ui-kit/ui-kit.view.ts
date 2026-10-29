import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { UserCardDirective } from '@core/users/user-card/user-card.directive';
import { PRIORITY_OPTIONS, TICKET_STATUS_OPTIONS } from '@shared/domain/picker-options';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AchievementMedalComponent } from '@shared/ui/achievement-medal/achievement-medal.component';
import {
  MedalSize,
  medalLabel,
  tierText,
} from '@shared/ui/achievement-medal/achievement-medal.logic';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import {
  RegressionItemBadgeComponent,
  RegressionSessionBadgeComponent,
  SeverityBadgeComponent,
  TestCaseStatusBadgeComponent,
} from '@shared/ui/domain/domain-badges';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusBadgeComponent } from '@shared/ui/domain/status-badge.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { SegmentedControlComponent } from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { UiKitStore } from './ui-kit.store';

/// Living catalogue of the shared UI kit at /dev/ui-kit, for design review and as a usage
/// reference for feature teams.
@Component({
  selector: 'tk-ui-kit-view',
  imports: [
    MatButtonModule,
    UserCardDirective,
    TypeIconComponent,
    StatusBadgeComponent,
    PriorityIconComponent,
    SeverityBadgeComponent,
    TestCaseStatusBadgeComponent,
    RegressionItemBadgeComponent,
    RegressionSessionBadgeComponent,
    LabelChipComponent,
    AvatarComponent,
    AchievementMedalComponent,
    UserDisplayComponent,
    SegmentedControlComponent,
    InlinePickerDirective,
    MarkdownViewerComponent,
    MarkdownEditorComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    KbdComponent,
    RelativeTimePipe,
  ],
  providers: [UiKitStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-dev.ui-kit' },
  templateUrl: './ui-kit.view.html',
  styleUrl: './ui-kit.view.scss',
})
export class UiKitView {
  protected readonly store = inject(UiKitStore);
  protected readonly statusOptions = TICKET_STATUS_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly medals = MEDAL_STATES.map((m) => ({
    ...m,
    tierText: m.masked ? 'Secret' : tierText(m),
    label: medalLabel(m),
  }));
  protected readonly medalSizes: MedalSize[] = [64, 48, 32, 20];
}

const MEDAL_STATES = [
  { state: 'Locked', id: 'connector', name: 'Connector', icon: 'link', tier: 0, tierCount: 3 },
  {
    state: 'In progress',
    id: 'triage',
    name: 'Triage',
    icon: 'user-share',
    tier: 0,
    tierCount: 3,
    progress: '4 of 10 to Bronze',
  },
  {
    state: 'Bronze',
    id: 'conversationalist',
    name: 'Conversationalist',
    icon: 'messages',
    tier: 1,
    tierCount: 4,
  },
  { state: 'Silver', id: 'reporter', name: 'Reporter', icon: 'file-plus', tier: 2, tierCount: 4 },
  { state: 'Gold', id: 'closer', name: 'Closer', icon: 'circle-check', tier: 3, tierCount: 4 },
  {
    state: 'Platinum',
    id: 'ready-for-review',
    name: 'Ready for review',
    icon: 'git-pull-request',
    tier: 4,
    tierCount: 4,
  },
  {
    state: 'One-time',
    id: 'board-builder',
    name: 'Board builder',
    icon: 'layout-kanban',
    tier: 1,
    tierCount: 1,
  },
  {
    state: 'Secret, locked',
    id: null,
    name: null,
    icon: null,
    tier: 0,
    tierCount: 0,
    secret: true,
    masked: true,
  },
  {
    state: 'Secret, earned',
    id: 'second-thoughts',
    name: 'Second thoughts',
    icon: 'arrow-back-up',
    tier: 1,
    tierCount: 1,
    secret: true,
  },
].map((m) => ({ secret: false, masked: false, progress: null, ...m }));
