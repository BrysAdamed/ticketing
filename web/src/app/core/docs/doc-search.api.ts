import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient, Query } from '../api/api-client';
import { UserRef } from '../tickets/ticket.models';

export type DocSearchKind = 'Folder' | 'Page' | 'Diagram';
export type DocSearchFormat = 'Mermaid' | 'Canvas';
export type DocSearchSort = 'Relevance' | 'Updated';

/// A part of a string to emphasise, as UTF-16 offsets.
export interface TextRange {
  start: number;
  length: number;
}

/// Plain text around a search match (never HTML) with the matched ranges.
export interface DocSnippet {
  text: string;
  highlights: TextRange[];
}

/// One item of `GET /api/v1/docs/search`.
export interface DocSearchItem {
  id: string;
  key: string;
  projectKey: string;
  kind: DocSearchKind;
  diagramFormat: DocSearchFormat | null;
  title: string;
  path: string;
  folderPath: string;
  version: number;
  updatedBy: UserRef;
  updatedAt: string;
  url: string;
  snippet: DocSnippet | null;
}

export interface DocSearchPage {
  items: DocSearchItem[];
  nextCursor: string | null;
  total: number | null;
  totalCapped: boolean;
  sort: DocSearchSort;
}

/// Docs search (spec 12.7). Filters use the query format of `docs/architecture/search-url-format.md`.
@Injectable({ providedIn: 'root' })
export class DocSearchApi {
  private readonly api = inject(ApiClient);

  search(query: Query): Observable<DocSearchPage> {
    return this.api.get<DocSearchPage>('/docs/search', query);
  }
}

/// The icon of a doc kind: folder, page, Mermaid diagram or Canvas.
export function docKindIcon(kind: DocSearchKind, format: DocSearchFormat | null): string {
  if (kind === 'Folder') return 'tablerFolder';
  if (kind === 'Diagram') return format === 'Canvas' ? 'tablerChalkboard' : 'tablerSitemap';
  return 'tablerFileText';
}
