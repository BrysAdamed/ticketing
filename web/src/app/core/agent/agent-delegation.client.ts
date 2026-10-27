import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { TicketType } from '@shared/domain/enums';
import { ApiClient } from '../api/api-client';
import { Ticket } from '../tickets/ticket.models';
import { ClaudeApp } from './claude-deep-link';

export interface AgentPromptUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
}

export type OutsiderContentSource = 'Title' | 'Description' | 'Comment' | 'Attachment';

export const OUTSIDER_CONTENT_LABELS: Record<OutsiderContentSource, string> = {
  Title: 'changed the title',
  Description: 'wrote the description',
  Comment: 'wrote a comment',
  Attachment: 'attached a file',
};

/// `GET /tickets/{key}/agent-prompt` (TKT-28, D-100).
export interface ResolvedAgentPrompt {
  prompt: string;
  ticketKey: string;
  ticketType: TicketType;
  template: {
    source: 'Default' | 'Custom';
    version: number;
    updatedAt: string;
    updatedBy: AgentPromptUser | null;
  };
  guardrailsVersion: number;
  /// Set on public projects when any title or description write, comment or attachment came from a
  /// non-member: the newest one (D-104).
  outsiderContent: {
    source: OutsiderContentSource;
    author: AgentPromptUser | null;
    at: string;
  } | null;
}

/// The resolved prompt of a ticket and the delegation record (refinement §6).
@Injectable({ providedIn: 'root' })
export class AgentDelegationClient {
  private readonly api = inject(ApiClient);

  prompt(ticketKey: string): Observable<ResolvedAgentPrompt> {
    return this.api.get<ResolvedAgentPrompt>(`/tickets/${ticketKey}/agent-prompt`);
  }

  /// Writes `ticket.agent.delegated` with the versions of the prompt that was launched (D-105) and
  /// applies the project's on-delegate settings; returns the ticket.
  recordDelegation(launched: ResolvedAgentPrompt, app: ClaudeApp): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${launched.ticketKey}/agent-delegations`, {
      app,
      launched: {
        templateSource: launched.template.source,
        templateVersion: launched.template.version,
        guardrailsVersion: launched.guardrailsVersion,
      },
    });
  }
}
