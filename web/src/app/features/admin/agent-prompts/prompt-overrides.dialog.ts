import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AgentPromptOverride, AgentPromptSlot } from '@core/agent/agent-prompt.models';
import { AgentPromptsClient } from '@core/agent/agent-prompts.client';
import { promptSlotLabel, promptSlotSlug } from '@core/agent/prompt-slugs';
import { ApiError, toApiError } from '@core/api/api-error';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';

export interface PromptOverridesDialogData {
  slot: AgentPromptSlot;
}

/// The projects behind a default's override count: their mode for the type and a link to their
/// Agent settings for it.
@Component({
  selector: 'tk-prompt-overrides-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    RouterLink,
    BadgeComponent,
    UserDisplayComponent,
    EmptyStateComponent,
    IconComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-overrides-dialog' },
  template: `
    <h2 mat-dialog-title>Projects overriding the {{ label }} default</h2>
    <mat-dialog-content>
      @if (error(); as error) {
        <tk-empty-state
          icon="tablerAlertCircle"
          tone="danger"
          title="Couldn't load the projects"
          [description]="error.title"
        />
      } @else if (overrides(); as overrides) {
        @if (overrides.length === 0) {
          <tk-empty-state
            icon="tablerFolders"
            title="No project overrides it"
            description="Every project uses the default for this type."
          />
        } @else {
          <ul class="list">
            @for (item of overrides; track item.projectKey) {
              <li class="row" [attr.data-testid]="'agent-override-' + item.projectKey">
                <a
                  class="project"
                  mat-dialog-close
                  [routerLink]="['/projects', item.projectKey, 'settings', 'agent', slug]"
                >
                  <span class="key">{{ item.projectKey }}</span>
                  <span class="project-name">{{ item.projectName }}</span>
                </a>
                @if (item.isArchived) {
                  <tk-badge tone="muted">Archived</tk-badge>
                }
                <tk-badge [tone]="item.mode === 'Custom' ? 'violet' : 'muted'">
                  {{ item.mode === 'Custom' ? 'Custom v' + item.version : 'Off' }}
                </tk-badge>
                @if (item.defaultChanged) {
                  <tk-badge tone="amber" [dot]="true">Default changed</tk-badge>
                }
                <span class="spacer"></span>
                <span class="changed">
                  <tk-user [user]="item.updatedBy" emptyLabel="System" />
                  <span class="tk-subtle" [title]="item.updatedAt | absoluteTime">
                    {{ item.updatedAt | relativeTime }}
                  </span>
                </span>
              </li>
            }
          </ul>
        }
      } @else {
        <tk-skeleton-rows [count]="3" />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Close</button>
    </mat-dialog-actions>
  `,
  styles: `
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
    }
    .row {
      position: relative;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
      min-height: 40px;
      padding: 4px 12px;
    }
    .row + .row {
      border-top: 1px solid var(--tk-border-subtle);
    }
    .row:hover {
      background: var(--tk-bg-hover);
    }
    .project {
      display: inline-flex;
      align-items: baseline;
      gap: 8px;
      min-width: 0;
      color: var(--tk-text);
      text-decoration: none;
    }
    .project::after {
      content: '';
      position: absolute;
      inset: 0;
    }
    .project:focus-visible {
      outline: none;
    }
    .project:focus-visible::after {
      outline: 2px solid var(--tk-focus);
      outline-offset: -2px;
    }
    .key {
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
    }
    .project-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .spacer {
      flex: 1;
    }
    .changed {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class PromptOverridesDialog {
  private readonly data = inject<PromptOverridesDialogData>(MAT_DIALOG_DATA);
  private readonly client = inject(AgentPromptsClient);

  protected readonly label = promptSlotLabel(this.data.slot);
  protected readonly slug = promptSlotSlug(this.data.slot);
  protected readonly overrides = signal<AgentPromptOverride[] | null>(null);
  protected readonly error = signal<ApiError | null>(null);

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.overrides.set(await firstValueFrom(this.client.overrides(this.data.slot)));
    } catch (error) {
      this.error.set(toApiError(error));
    }
  }
}
