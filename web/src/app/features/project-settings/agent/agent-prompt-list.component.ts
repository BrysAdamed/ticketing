import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ProjectAgentPromptSummary } from '@core/agent/agent-prompt.models';
import { TICKET_TYPE_LABELS } from '@shared/domain/enums';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent, BadgeTone } from '@shared/ui/domain/badge.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AgentSettingsStore } from './agent-settings.store';
import { promptTypeSlug } from './prompt-slugs';

/// The five ticket types with the prompt each one uses (state chip) and its last change.
@Component({
  selector: 'tk-agent-prompt-list',
  imports: [
    RouterLink,
    BadgeComponent,
    TypeIconComponent,
    UserDisplayComponent,
    IconComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styleUrl: '../settings-section.scss',
  host: { class: 'settings-section', 'data-testid': 'agent-prompts' },
  template: `
    <div class="section-head">
      <h2>Prompt per ticket type</h2>
      <span class="tk-subtle">What the agent is told when a ticket of that type is delegated.</span>
    </div>
    @if (store.prompts(); as prompts) {
      <ul class="box">
        @for (prompt of prompts; track prompt.type) {
          <li>
            <a
              class="row"
              [routerLink]="slug(prompt)"
              [attr.data-testid]="'agent-prompt-row-' + prompt.type"
            >
              <tk-type-icon [type]="prompt.type" />
              <span class="name">{{ label(prompt) }}</span>
              <tk-badge
                [tone]="tone(prompt)"
                [attr.data-testid]="'agent-prompt-chip-' + prompt.type"
              >
                {{ chip(prompt) }}
              </tk-badge>
              @if (prompt.defaultChanged) {
                <tk-badge
                  tone="amber"
                  [dot]="true"
                  [attr.data-testid]="'agent-prompt-default-changed-' + prompt.type"
                >
                  Default changed
                </tk-badge>
              }
              <span class="spacer"></span>
              @if (prompt.updatedAt) {
                <span class="changed">
                  <tk-user [user]="prompt.updatedBy" emptyLabel="System" />
                  <span class="tk-subtle" [title]="prompt.updatedAt | absoluteTime">
                    {{ prompt.updatedAt | relativeTime }}
                  </span>
                </span>
              } @else {
                <span class="tk-subtle">Never changed</span>
              }
              <tk-icon name="tablerChevronRight" [size]="16" class="chevron" />
            </a>
          </li>
        }
      </ul>
    } @else {
      <tk-skeleton-rows [count]="5" />
    }
  `,
  styles: `
    .box {
      margin: 0;
      padding: 0;
      list-style: none;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
    }
    li + li {
      border-top: 1px solid var(--tk-border-subtle);
    }
    .row {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 40px;
      padding: 0 12px;
      color: var(--tk-text);
      text-decoration: none;
    }
    .row:hover {
      background: var(--tk-bg-hover);
    }
    .row:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: -2px;
    }
    .name {
      min-width: 96px;
      font-weight: var(--tk-weight-medium);
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
    .chevron {
      color: var(--tk-text-subtle);
    }
  `,
})
export class AgentPromptListComponent {
  protected readonly store = inject(AgentSettingsStore);

  protected slug(prompt: ProjectAgentPromptSummary): string {
    return promptTypeSlug(prompt.type);
  }

  protected label(prompt: ProjectAgentPromptSummary): string {
    return TICKET_TYPE_LABELS[prompt.type];
  }

  protected chip(prompt: ProjectAgentPromptSummary): string {
    if (prompt.mode === 'Off') return 'Off';
    return prompt.mode === 'Custom'
      ? `Custom v${prompt.version}`
      : `Default v${prompt.defaultVersion}`;
  }

  protected tone(prompt: ProjectAgentPromptSummary): BadgeTone {
    return prompt.mode === 'Custom' ? 'violet' : prompt.mode === 'Off' ? 'muted' : 'gray';
  }
}
