import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { AgentPromptListComponent } from './agent-prompt-list.component';
import { AgentSettingsStore } from './agent-settings.store';
import { AgentSetupCardComponent } from './agent-setup-card.component';

/// Project settings → Agent: the delegation setup and the prompt per ticket type.
@Component({
  selector: 'tk-agent-settings-view',
  imports: [
    MatButtonModule,
    AgentSetupCardComponent,
    AgentPromptListComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
  ],
  providers: [AgentSettingsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-project.settings.agent' },
  template: `
    @switch (store.status()) {
      @case ('loaded') {
        <div class="body">
          <tk-agent-setup-card />
          <tk-agent-prompt-list />
        </div>
      }
      @case ('error') {
        @if (store.error()?.isNotFound) {
          <tk-empty-state
            icon="tablerRobot"
            data-testid="agent-unavailable"
            title="Agent delegation isn't available"
            description="It is turned off for you, or this instance has no public URL yet. Ask an Admin."
          />
        } @else {
          <tk-empty-state
            icon="tablerAlertCircle"
            tone="danger"
            title="Couldn't load the agent settings"
            [description]="store.error()?.title ?? null"
          >
            <button mat-stroked-button type="button" (click)="load()">Retry</button>
          </tk-empty-state>
        }
      }
      @default {
        <div class="body"><tk-skeleton-rows [count]="10" /></div>
      }
    }
  `,
  styles: `
    .body {
      max-width: 880px;
      padding: 20px 24px 64px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }
  `,
})
export class AgentSettingsView {
  protected readonly store = inject(AgentSettingsStore);
  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => void this.store.load(key));
    });
  }

  protected load(): void {
    void this.store.load(this.projectKey());
  }
}
