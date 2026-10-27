import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProjectAgentPromptSummary } from '@core/agent/agent-prompt.models';
import { AgentPromptsClient } from '@core/agent/agent-prompts.client';
import {
  ProjectAgentSettingsClient,
  ProjectAgentSettingsPatch,
} from '@core/agent/project-agent-settings.client';
import { ApiError, toApiError } from '@core/api/api-error';
import { ProjectAgentSettings, ProjectContext } from '@core/projects/project-context';
import { LoadStatus } from '@core/projects/project-directory';

/// Agent tab of project settings: the delegation setup and the five ticket types' prompt state.
/// Owners of a live project edit; everyone who can read the project sees it read-only.
@Injectable()
export class AgentSettingsStore {
  private readonly context = inject(ProjectContext);
  private readonly settingsClient = inject(ProjectAgentSettingsClient);
  private readonly promptsClient = inject(AgentPromptsClient);

  readonly projectKey = signal('');
  readonly settings = signal<ProjectAgentSettings | null>(null);
  readonly prompts = signal<ProjectAgentPromptSummary[] | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly saving = signal(false);

  readonly isArchived = this.context.isArchived;
  readonly canManage = computed(() => this.context.isOwner() && !this.context.isArchived());

  async load(projectKey: string): Promise<void> {
    const key = projectKey.toUpperCase();
    this.projectKey.set(key);
    this.status.set('loading');
    this.error.set(null);
    try {
      const [settings, prompts] = await Promise.all([
        firstValueFrom(this.settingsClient.get(key)),
        firstValueFrom(this.promptsClient.listProject(key)),
      ]);
      if (key !== this.projectKey()) return;
      this.settings.set(settings);
      this.prompts.set(prompts);
      this.status.set('loaded');
    } catch (error) {
      if (key !== this.projectKey()) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  /// Saves changed setup fields. A stale row version reloads the setup and rethrows, like every other
  /// project write; the project in context is refreshed so its row version and `agent` stay current.
  async save(patch: ProjectAgentSettingsPatch): Promise<void> {
    const settings = this.settings();
    if (!settings) return;
    this.saving.set(true);
    try {
      this.settings.set(
        await firstValueFrom(
          this.settingsClient.update(this.projectKey(), patch, settings.rowVersion),
        ),
      );
      void this.context.reload();
    } catch (error) {
      if (toApiError(error).code === 'concurrency.conflict') {
        this.settings.set(await firstValueFrom(this.settingsClient.get(this.projectKey())));
        void this.context.reload();
      }
      throw error;
    } finally {
      this.saving.set(false);
    }
  }
}
