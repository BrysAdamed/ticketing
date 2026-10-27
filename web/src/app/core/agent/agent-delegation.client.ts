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

export type OutsiderContentSource =
  'Title' | 'Description' | 'Comment' | 'Attachment' | 'RelatedTicket' | 'TestCase';

/// What the outsider did, followed by `itemKey` when there is one (D-106).
export const OUTSIDER_CONTENT_LABELS: Record<OutsiderContentSource, string> = {
  Title: 'changed the title',
  Description: 'wrote the description',
  Comment: 'wrote a comment',
  Attachment: 'attached a file',
  RelatedTicket: 'wrote on the related ticket',
  TestCase: 'wrote the test case',
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
  /// The newest text the agent reads (the ticket, its parent, children, linked tickets and test
  /// cases) written by someone who is not an Owner or Member of `projectKey` (D-104, D-106).
  /// `itemKey` names the related ticket or test case, null for the ticket itself.
  outsiderContent: {
    source: OutsiderContentSource;
    author: AgentPromptUser | null;
    at: string;
    projectKey: string;
    itemKey: string | null;
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
