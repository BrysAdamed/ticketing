import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { InstanceAgentPromptSummary } from '@core/agent/agent-prompt.models';
import { promptSlotLabel, promptSlotSlug } from '@core/agent/prompt-slugs';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AgentPromptsStore } from './agent-prompts.store';
import { PromptOverridesDialog, PromptOverridesDialogData } from './prompt-overrides.dialog';
import { PublicUrlStatusComponent } from './public-url-status.component';

/// Admin → Agent prompts: the `TICKETING_PUBLIC_URL` status, the default prompt per ticket type
/// (with how many projects override it) and the guardrails appended to every prompt.
@Component({
  selector: 'tk-agent-prompts-view',
  imports: [
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    BadgeComponent,
    TypeIconComponent,
    UserDisplayComponent,
    EmptyStateComponent,
    IconComponent,
    SkeletonRowsComponent,
    PublicUrlStatusComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  providers: [AgentPromptsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.agent-prompts' },
  templateUrl: './agent-prompts.view.html',
  styleUrl: './agent-prompts.view.scss',
})
export class AgentPromptsView {
  protected readonly store = inject(AgentPromptsStore);
  private readonly dialog = inject(MatDialog);

  constructor() {
    void this.store.load();
  }

  protected slug(prompt: InstanceAgentPromptSummary): string {
    return promptSlotSlug(prompt.slot);
  }

  protected label(prompt: InstanceAgentPromptSummary): string {
    return promptSlotLabel(prompt.slot);
  }

  protected openOverrides(prompt: InstanceAgentPromptSummary): void {
    this.dialog.open<PromptOverridesDialog, PromptOverridesDialogData>(PromptOverridesDialog, {
      width: '640px',
      data: { slot: prompt.slot },
    });
  }
}
