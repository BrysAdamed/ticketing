import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { PRIORITY_OPTIONS, TICKET_STATUS_OPTIONS } from '@shared/domain/picker-options';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
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
    TypeIconComponent,
    StatusBadgeComponent,
    PriorityIconComponent,
    SeverityBadgeComponent,
    TestCaseStatusBadgeComponent,
    RegressionItemBadgeComponent,
    RegressionSessionBadgeComponent,
    LabelChipComponent,
    AvatarComponent,
    UserDisplayComponent,
    SegmentedControlComponent,
    InlinePickerDirective,
    MarkdownViewerComponent,
    MarkdownEditorComponent,
    SkeletonRowsComponent,
    EmptyStateComponent,
    KbdComponent,
    RelativeTimePipe,
    TourAnchorDirective,
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
}
