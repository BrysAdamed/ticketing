import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page, PageRequest } from '../api/page';
import {
  DeletedDoc,
  Doc,
  DocPlacement,
  DocSummary,
  DocTrashItem,
  DocTree,
  NewDoc,
} from './doc.models';

/// Typed client for the Docs REST API (spec 12.6). Tree reads are project-scoped; everything
/// else addresses one doc by key (`WEB-D-12`) or id.
@Injectable({ providedIn: 'root' })
export class DocsApi {
  private readonly api = inject(ApiClient);

  tree(projectKey: string): Observable<DocTree> {
    return this.api.get<DocTree>(`/projects/${projectKey}/docs/tree`);
  }

  recent(projectKey: string, limit = 10): Observable<DocSummary[]> {
    return this.api.get<DocSummary[]>(`/projects/${projectKey}/docs/recent`, { limit });
  }

  trash(projectKey: string, page?: PageRequest): Observable<Page<DocTrashItem>> {
    return this.api.list<DocTrashItem>(`/projects/${projectKey}/docs/trash`, page);
  }

  get(key: string): Observable<Doc> {
    return this.api.get<Doc>(`/docs/${encodeURIComponent(key)}`);
  }

  create(projectKey: string, doc: NewDoc, idempotencyKey?: string): Observable<Doc> {
    return this.api.post<Doc>(`/projects/${projectKey}/docs`, doc, { idempotencyKey });
  }

  rename(key: string, title: string): Observable<Doc> {
    return this.api.patch<Doc>(`/docs/${encodeURIComponent(key)}`, { title });
  }

  move(key: string, placement: DocPlacement): Observable<Doc> {
    return this.api.post<Doc>(`/docs/${encodeURIComponent(key)}/move`, placement);
  }

  duplicate(key: string): Observable<Doc> {
    return this.api.post<Doc>(`/docs/${encodeURIComponent(key)}/duplicate`);
  }

  delete(key: string): Observable<DeletedDoc> {
    return this.api.delete<DeletedDoc>(`/docs/${encodeURIComponent(key)}`);
  }

  restore(key: string): Observable<Doc> {
    return this.api.post<Doc>(`/docs/${encodeURIComponent(key)}/restore`);
  }
}
