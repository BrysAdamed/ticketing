import { inject, Injectable } from '@angular/core';
import { Observable, shareReplay } from 'rxjs';
import { ApiClient } from '../api/api-client';
import {
  AgentInstanceStatus,
  AgentPromptOverride,
  AgentPromptPlaceholder,
  AgentPromptPreview,
  AgentPromptScope,
  AgentPromptSlot,
  AgentPromptVersion,
  AgentPromptVersionChange,
  AgentPromptVersionSummary,
  InstanceAgentPrompt,
  InstanceAgentPromptSummary,
  ProjectAgentPrompt,
  ProjectAgentPromptSummary,
  SaveAgentPrompt,
} from './agent-prompt.models';

/// REST client for agent prompt templates (`/projects/{pk}/agent/prompts` and `/admin/agent/prompts`).
/// The slot-level calls take a scope, so project and instance editors share them.
@Injectable({ providedIn: 'root' })
export class AgentPromptsClient {
  private readonly api = inject(ApiClient);
  private placeholders$: Observable<AgentPromptPlaceholder[]> | null = null;

  listProject(projectKey: string): Observable<ProjectAgentPromptSummary[]> {
    return this.api.get(base({ kind: 'project', projectKey }));
  }

  listInstance(): Observable<InstanceAgentPromptSummary[]> {
    return this.api.get(base({ kind: 'instance' }));
  }

  /// Admins: whether `TICKETING_PUBLIC_URL` is set. Needs only the flag, unlike every other call.
  instanceStatus(): Observable<AgentInstanceStatus> {
    return this.api.get('/admin/agent/status');
  }

  /// Admins: the projects that override a ticket type's default (Custom or Off).
  overrides(slot: AgentPromptSlot): Observable<AgentPromptOverride[]> {
    return this.api.get(`${slotPath({ kind: 'instance' }, slot)}/overrides`);
  }

  getProject(projectKey: string, slot: AgentPromptSlot): Observable<ProjectAgentPrompt> {
    return this.api.get(slotPath({ kind: 'project', projectKey }, slot));
  }

  getInstance(slot: AgentPromptSlot): Observable<InstanceAgentPrompt> {
    return this.api.get(slotPath({ kind: 'instance' }, slot));
  }

  save<T extends ProjectAgentPrompt | InstanceAgentPrompt>(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
    request: SaveAgentPrompt,
  ): Observable<T> {
    return this.api.put(slotPath(scope, slot), request);
  }

  /// Project scope: back to the instance default (Inherit) as a new version.
  resetProject(
    projectKey: string,
    slot: AgentPromptSlot,
    request: AgentPromptVersionChange,
  ): Observable<ProjectAgentPrompt> {
    return this.api.post(`${slotPath({ kind: 'project', projectKey }, slot)}/reset`, request);
  }

  /// Instance scope: takes the shipped built-in as a new version.
  resetInstanceToBuiltIn(
    slot: AgentPromptSlot,
    request: AgentPromptVersionChange,
  ): Observable<InstanceAgentPrompt> {
    return this.api.post(`${slotPath({ kind: 'instance' }, slot)}/reset-built-in`, request);
  }

  versions(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
  ): Observable<AgentPromptVersionSummary[]> {
    return this.api.get(`${slotPath(scope, slot)}/versions`);
  }

  version(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
    number: number,
  ): Observable<AgentPromptVersion> {
    return this.api.get(`${slotPath(scope, slot)}/versions/${number}`);
  }

  restore(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
    number: number,
    request: AgentPromptVersionChange,
  ): Observable<AgentPromptVersion> {
    return this.api.post(`${slotPath(scope, slot)}/versions/${number}/restore`, request);
  }

  preview(
    scope: AgentPromptScope,
    slot: AgentPromptSlot,
    body: string | null,
    ticketKey: string | null,
  ): Observable<AgentPromptPreview> {
    return this.api.post(`${slotPath(scope, slot)}/preview`, { body, ticketKey });
  }

  /// The placeholder list never changes while the app runs, so it is fetched once.
  placeholders(): Observable<AgentPromptPlaceholder[]> {
    this.placeholders$ ??= this.api
      .get<AgentPromptPlaceholder[]>('/agent/prompt-placeholders')
      .pipe(shareReplay({ bufferSize: 1, refCount: false }));
    return this.placeholders$;
  }
}

function base(scope: AgentPromptScope): string {
  return scope.kind === 'project'
    ? `/projects/${scope.projectKey}/agent/prompts`
    : '/admin/agent/prompts';
}

function slotPath(scope: AgentPromptScope, slot: AgentPromptSlot): string {
  return `${base(scope)}/${slot}`;
}
