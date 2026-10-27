import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { UserRef } from '../tickets/ticket.models';
import { Doc, WriteChannel } from './doc.models';

export type DocHistoryItemType = 'Version' | 'Activity';

/// One entry of a doc's history: a published version, or an activity entry no version represents
/// (rename, move, delete, restore, attachments, comments) with its action and JSON values.
export interface DocHistoryItem {
  id: string;
  type: DocHistoryItemType;
  at: string;
  actor: UserRef | null;
  channel: WriteChannel | null;
  version: number | null;
  title: string | null;
  changeNote: string | null;
  restoredFrom: number | null;
  action: string | null;
  field: string | null;
  oldValue: unknown;
  newValue: unknown;
}

/// A page of `GET /docs/{key}/history`, newest first.
export interface DocHistoryPage {
  docKey: string;
  currentVersion: number;
  items: DocHistoryItem[];
  nextCursor: string | null;
}

/// Version history of a doc (spec 1.6): the merged history and restoring a version. One version
/// with its content is `DocsApi.version`.
@Injectable({ providedIn: 'root' })
export class DocHistoryApi {
  private readonly api = inject(ApiClient);

  history(key: string, cursor: string | null = null, limit = 50): Observable<DocHistoryPage> {
    return this.api.get<DocHistoryPage>(`/docs/${encodeURIComponent(key)}/history`, {
      limit,
      ...(cursor ? { cursor } : {}),
    });
  }

  /// Publishes version `number`'s title and content as a new version (`restoredFrom = number`).
  restore(key: string, number: number, changeNote: string | null = null): Observable<Doc> {
    return this.api.post<Doc>(`/docs/${encodeURIComponent(key)}/versions/${number}/restore`, {
      changeNote,
    });
  }
}
