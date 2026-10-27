import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { DocMentions } from './doc.models';

/// How many docs the ticket view lists under "Docs mentioning this ticket" before "and N more".
export const TICKET_DOCS_LIMIT = 20;

/// Docs that mention a ticket (spec 1.9). A doc's own references and backlinks come with
/// `GET /docs/{key}`, so they need no call here.
@Injectable({ providedIn: 'root' })
export class DocMentionsApi {
  private readonly api = inject(ApiClient);

  forTicket(ticketKey: string, limit = TICKET_DOCS_LIMIT): Observable<DocMentions> {
    return this.api.get<DocMentions>(`/tickets/${encodeURIComponent(ticketKey)}/docs`, { limit });
  }
}
