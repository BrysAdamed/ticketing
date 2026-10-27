import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AgentDelegationClient } from '@core/agent/agent-delegation.client';
import { ApiClient } from '@core/api/api-client';
import { toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { ProjectDetail, projectCacheKey } from '@core/projects/project-context';
import { Ticket } from '@core/tickets/ticket.models';
import { delegateState, needsPrompt, PromptLoad } from './delegate-state';

/// State of one Delegate button: the ticket's project (shared SWR cache with the project pages, so
/// Agent settings changes show up) and the resolved prompt, preloaded because the launch has to
/// happen synchronously in the click handler (ADR 0013).
@Injectable()
export class DelegateActionStore {
  private readonly api = inject(ApiClient);
  private readonly cache = inject(SwrCache);
  private readonly client = inject(AgentDelegationClient);

  readonly ticket = signal<Ticket | null>(null);
  readonly project = signal<ProjectDetail | null>(null);
  readonly promptLoad = signal<PromptLoad>({ status: 'idle' });
  readonly state = computed(() => {
    const ticket = this.ticket();
    return ticket
      ? delegateState(ticket, this.project(), this.promptLoad())
      : ({ kind: 'hidden' } as const);
  });

  private projectToken = 0;
  private promptFor: string | null = null;

  constructor() {
    effect(() => {
      const key = this.ticket()?.projectKey;
      if (key) untracked(() => void this.loadProject(key));
    });

    effect(() => {
      const ticket = this.ticket();
      const project = this.project();
      if (!ticket || !needsPrompt(ticket, project)) return;
      const id = `${ticket.key}|${ticket.type}|${project?.agent?.rowVersion}`;
      if (id !== this.promptFor) untracked(() => void this.loadPrompt(ticket.key, id));
    });
  }

  reloadPrompt(): void {
    const ticket = this.ticket();
    if (ticket && this.promptFor) void this.loadPrompt(ticket.key, this.promptFor);
  }

  private async loadProject(key: string): Promise<void> {
    if (this.project()?.key === key) return;
    const token = ++this.projectToken;
    const cacheKey = projectCacheKey(key);
    const { cached, fresh } = this.cache.load(
      cacheKey,
      () => firstValueFrom(this.api.get<ProjectDetail>(`/projects/${key}`)),
      [cacheKey],
    );
    if (cached) this.project.set(cached);
    try {
      const project = await fresh;
      if (token === this.projectToken) this.project.set(project);
    } catch {
      if (token === this.projectToken && !cached) this.project.set(null);
    }
  }

  private async loadPrompt(ticketKey: string, id: string): Promise<void> {
    this.promptFor = id;
    this.promptLoad.set({ status: 'loading' });
    try {
      const prompt = await firstValueFrom(this.client.prompt(ticketKey));
      if (this.promptFor === id) this.promptLoad.set({ status: 'loaded', prompt });
    } catch (error) {
      if (this.promptFor === id) this.promptLoad.set({ status: 'error', error: toApiError(error) });
    }
  }
}
