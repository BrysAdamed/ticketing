import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page, PageRequest } from '../api/page';
import { UserRef } from '../tickets/ticket.models';

/// A comment below a page or diagram (`/docs/{key}/comments`). Deleted comments keep their place
/// with an empty body. `mentions` are the mentioned users who are active and can read the project,
/// rendered as chips (D-96, D-162).
export interface DocComment {
  id: string;
  docKey: string;
  author: UserRef;
  body: string;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  deletedAt: string | null;
  canEdit: boolean;
  canDelete: boolean;
  mentions: UserRef[];
}

/// Typed client for the doc comment thread (docs refinement D12): list and add per doc, edit and
/// delete by comment id.
@Injectable({ providedIn: 'root' })
export class DocCommentsApi {
  private readonly api = inject(ApiClient);

  list(docKey: string, page?: PageRequest): Observable<Page<DocComment>> {
    return this.api.list<DocComment>(`/docs/${encodeURIComponent(docKey)}/comments`, page);
  }

  add(docKey: string, body: string): Observable<DocComment> {
    return this.api.post<DocComment>(`/docs/${encodeURIComponent(docKey)}/comments`, { body });
  }

  edit(id: string, body: string): Observable<DocComment> {
    return this.api.patch<DocComment>(`/docs/comments/${id}`, { body });
  }

  delete(id: string): Observable<DocComment> {
    return this.api.delete<DocComment>(`/docs/comments/${id}`);
  }
}
