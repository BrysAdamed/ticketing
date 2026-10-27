import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AgentInstanceStatus, InstanceAgentPromptSummary } from '@core/agent/agent-prompt.models';
import { AgentPromptsClient } from '@core/agent/agent-prompts.client';
import { ApiError, toApiError } from '@core/api/api-error';
import { LoadStatus } from '@core/projects/project-directory';

/// Admin → Agent prompts: the instance status (`TICKETING_PUBLIC_URL`) and the five defaults plus
/// the guardrails. The prompts are only loaded while delegation is available; without the public
/// URL every prompt endpoint is `agent.disabled` and the page explains why instead (D-103).
@Injectable()
export class AgentPromptsStore {
  private readonly client = inject(AgentPromptsClient);

  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly instance = signal<AgentInstanceStatus | null>(null);
  readonly prompts = signal<InstanceAgentPromptSummary[] | null>(null);

  readonly types = computed(() => this.prompts()?.filter((p) => p.slot !== 'Guardrails') ?? []);
  readonly guardrails = computed(
    () => this.prompts()?.find((p) => p.slot === 'Guardrails') ?? null,
  );

  async load(): Promise<void> {
    this.status.set('loading');
    this.error.set(null);
    try {
      const instance = await firstValueFrom(this.client.instanceStatus());
      this.instance.set(instance);
      this.prompts.set(
        instance.delegationAvailable ? await firstValueFrom(this.client.listInstance()) : null,
      );
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }
}
