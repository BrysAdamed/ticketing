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
  /// Set on public projects when the latest description write or comment came from a non-member.
  outsiderContent: {
    source: 'Description' | 'Comment';
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

  /// Writes `ticket.agent.delegated` and applies the project's on-delegate settings; returns the ticket.
  recordDelegation(ticketKey: string, app: ClaudeApp): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${ticketKey}/agent-delegations`, { app });
  }
}
