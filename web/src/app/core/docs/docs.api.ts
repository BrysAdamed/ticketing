import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Watchers } from '../tickets/ticket.models';
import { Page, PageRequest } from '../api/page';
import {
  DeletedDoc,
  Doc,
  DocDraft,
  DocPlacement,
  DocSummary,
  DocTrashItem,
  DocTree,
  DocVersion,
  NewDoc,
  SaveDocDraft,
  StoredDocSnapshot,
  UpdateDoc,
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

  /// Idempotent; read access is enough (viewers can watch). Pages and diagrams only.
  watch(key: string): Observable<Watchers> {
    return this.api.put<Watchers>(`/docs/${encodeURIComponent(key)}/watchers/me`, null);
  }

  unwatch(key: string): Observable<Watchers> {
    return this.api.delete<Watchers>(`/docs/${encodeURIComponent(key)}/watchers/me`);
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

  update(key: string, changes: UpdateDoc): Observable<Doc> {
    return this.api.patch<Doc>(`/docs/${encodeURIComponent(key)}`, changes);
  }

  version(key: string, number: number): Observable<DocVersion> {
    return this.api.get<DocVersion>(`/docs/${encodeURIComponent(key)}/versions/${number}`);
  }

  /// Stores the picture of a Canvas version that has none yet (writers; the first one wins).
  storeSnapshot(key: string, version: number, svg: string): Observable<StoredDocSnapshot> {
    return this.api.put<StoredDocSnapshot>(
      `/docs/${encodeURIComponent(key)}/versions/${version}/snapshot`,
      { svg },
    );
  }

  draft(key: string): Observable<DocDraft> {
    return this.api.get<DocDraft>(`/docs/${encodeURIComponent(key)}/draft`);
  }

  saveDraft(key: string, draft: SaveDocDraft): Observable<DocDraft> {
    return this.api.put<DocDraft>(`/docs/${encodeURIComponent(key)}/draft`, draft);
  }

  /// Saves the draft from `beforeunload`/`pagehide` with a keepalive request that outlives the page.
  /// Browsers drop keepalive bodies over 64 KB, so a larger draft is not sent: returns false.
  saveDraftOnUnload(key: string, draft: SaveDocDraft): boolean {
    const body = JSON.stringify(draft);
    if (!fitsKeepalive(body)) return false;
    void fetch(this.api.url(`/docs/${encodeURIComponent(key)}/draft`), {
      method: 'PUT',
      keepalive: true,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-XSRF-TOKEN': xsrfToken() },
      body,
    }).catch(() => undefined);
    return true;
  }

  discardDraft(key: string): Observable<void> {
    return this.api.delete(`/docs/${encodeURIComponent(key)}/draft`);
  }

  /// `GET /docs/{key}/export.md`: the raw markdown as a download.
  markdownExportUrl(key: string): string {
    return this.api.url(`/docs/${encodeURIComponent(key)}/export.md`);
  }

  /// The PDF of a page, diagram (`version` for an older one) or folder; dates in `timeZone`.
  pdfExportUrl(key: string, version?: number | null, timeZone?: string | null): string {
    const query = new URLSearchParams();
    if (version) query.set('version', String(version));
    if (timeZone) query.set('tz', timeZone);
    const search = query.toString();
    return this.api.url(`/docs/${encodeURIComponent(key)}/export.pdf${search ? `?${search}` : ''}`);
  }
}

function xsrfToken(): string {
  const match = /(?:^|;\s*)XSRF-TOKEN=([^;]*)/.exec(globalThis.document?.cookie ?? '');
  return match ? decodeURIComponent(match[1]) : '';
}

/// Keepalive requests may carry at most 64 KB; the rest of the request needs a little room too.
export const KEEPALIVE_MAX_BODY_BYTES = 60_000;

export function fitsKeepalive(body: string): boolean {
  return (
    body.length <= KEEPALIVE_MAX_BODY_BYTES &&
    new TextEncoder().encode(body).length <= KEEPALIVE_MAX_BODY_BYTES
  );
}
