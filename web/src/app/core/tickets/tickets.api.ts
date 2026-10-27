import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page, PageRequest } from '../api/page';
import { TicketLinkType, TicketType } from '@shared/domain/enums';
import {
  Backlog,
  Comment,
  HintField,
  NewTicket,
  MoveTicketsRequest,
  Ticket,
  TicketHistoryPage,
  TicketLink,
  TicketPatch,
  TicketRef,
  TicketSummary,
} from './ticket.models';

export interface BacklogQuery {
  showDone?: boolean;
  type?: readonly string[];
  status?: readonly string[];
  priority?: readonly string[];
  assignee?: string | null;
  label?: readonly string[];
  version?: string | null;
  text?: string | null;
}

/// Typed client for the tickets slice REST API.
@Injectable({ providedIn: 'root' })
export class TicketsApi {
  private readonly api = inject(ApiClient);

  get(key: string): Observable<Ticket> {
    return this.api.get<Ticket>(`/tickets/${encodeURIComponent(key)}`);
  }

  create(
    projectKey: string,
    ticket: NewTicket,
    idempotencyKey?: string,
  ): Observable<TicketSummary> {
    return this.api.post<TicketSummary>(`/projects/${projectKey}/tickets`, ticket, {
      idempotencyKey,
    });
  }

  /// `rowVersion` is sent as If-Match; the web UI does that only for title and description (D-43).
  update(key: string, patch: TicketPatch, rowVersion?: number): Observable<Ticket> {
    return this.api.patch<Ticket>(`/tickets/${encodeURIComponent(key)}`, patch, { rowVersion });
  }

  delete(key: string): Observable<void> {
    return this.api.delete(`/tickets/${encodeURIComponent(key)}`);
  }

  /// Undoes a delete within 10 minutes (Owner only, D-82): links, test cases and placement come back.
  restore(key: string): Observable<Ticket> {
    return this.api.post<Ticket>(`/tickets/${encodeURIComponent(key)}/restore`);
  }

  backlog(projectKey: string, query: BacklogQuery = {}): Observable<Backlog> {
    return this.api.get<Backlog>(`/projects/${projectKey}/backlog`, { ...query });
  }

  /// Every placement change: backlog reorder, backlog to board and back, board to board, column change.
  move(request: MoveTicketsRequest): Observable<TicketSummary[]> {
    return this.api.post<TicketSummary[]>('/tickets/move', request);
  }

  find(projectKey: string, text: string, types?: readonly TicketType[]): Observable<TicketRef[]> {
    return this.api.get<TicketRef[]>(`/projects/${projectKey}/tickets/find`, { text, type: types });
  }

  hints(projectKey: string, field: HintField, prefix = ''): Observable<string[]> {
    return this.api.get<string[]>(`/projects/${projectKey}/hints/${field}`, { prefix });
  }

  history(key: string, page?: PageRequest): Observable<TicketHistoryPage> {
    return this.api.get<TicketHistoryPage>(`/tickets/${encodeURIComponent(key)}/history`, {
      limit: page?.limit,
      cursor: page?.cursor,
    });
  }

  comments(key: string, page?: PageRequest): Observable<Page<Comment>> {
    return this.api.list<Comment>(`/tickets/${encodeURIComponent(key)}/comments`, page);
  }

  addComment(key: string, body: string): Observable<Comment> {
    return this.api.post<Comment>(`/tickets/${encodeURIComponent(key)}/comments`, { body });
  }

  editComment(id: string, body: string): Observable<Comment> {
    return this.api.patch<Comment>(`/comments/${id}`, { body });
  }

  deleteComment(id: string): Observable<Comment> {
    return this.api.delete<Comment>(`/comments/${id}`);
  }

  link(key: string, targetKey: string, type: TicketLinkType): Observable<TicketLink> {
    return this.api.post<TicketLink>(`/tickets/${encodeURIComponent(key)}/links`, {
      targetKey,
      type,
    });
  }

  unlink(key: string, linkId: string): Observable<void> {
    return this.api.delete(`/tickets/${encodeURIComponent(key)}/links/${linkId}`);
  }
}
