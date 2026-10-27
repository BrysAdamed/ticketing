import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { PaletteItem, PaletteScope, SearchProvider } from '@core/commands/command';
import { docKindIcon, DocSnippet } from '@core/docs/doc-search.api';
import { DiagramFormat, DocKind } from '@core/docs/doc.models';
import { RecentDoc, RecentDocs } from '@core/docs/recent-docs';
import { TicketType } from '@shared/domain/enums';
import {
  DOC_KEY_PATTERN,
  REGRESSION_SESSION_KEY_PATTERN,
  TEST_CASE_KEY_PATTERN,
  TICKET_KEY_PATTERN,
} from '@shared/domain/keys';
import { queryRanges } from '@shared/util/highlight';

/// Item of `GET /api/v1/quick-jump?q=`.
export interface QuickJumpItem {
  kind: 'Ticket' | 'TestCase' | 'RegressionSession' | 'Doc';
  id: string;
  key: string;
  title: string;
  projectKey: string;
  url: string;
  ticketType: TicketType | null;
  status: string | null;
  docKind?: DocKind | null;
  diagramFormat?: DiagramFormat | null;
  folderPath?: string | null;
  snippet?: DocSnippet | null;
}

/// Palette prefixes (spec 12.7): `p:` keeps only docs, `t:` only tickets.
export const DOCS_SCOPE: PaletteScope = { id: 'docs', prefix: 'p:', hint: 'docs only' };
export const TICKETS_SCOPE: PaletteScope = { id: 'tickets', prefix: 't:', hint: 'tickets only' };
export const QUICK_JUMP_SCOPES: readonly PaletteScope[] = [DOCS_SCOPE, TICKETS_SCOPE];
const API_SCOPES: Record<string, string> = { docs: 'Docs', tickets: 'Tickets' };

const DOCS_GROUP = 'Docs';
const GROUPS: Record<QuickJumpItem['kind'], string> = {
  Ticket: 'Tickets',
  TestCase: 'Test cases',
  RegressionSession: 'Regressions',
  Doc: DOCS_GROUP,
};
const ICONS: Record<QuickJumpItem['kind'], string> = {
  Ticket: 'tablerFileText',
  TestCase: 'tablerChecklist',
  RegressionSession: 'tablerListCheck',
  Doc: 'tablerFileText',
};
const TYPE_ICONS: Record<TicketType, string> = {
  Epic: 'tablerBolt',
  UserStory: 'tablerBookmark',
  Technical: 'tablerTool',
  Spike: 'tablerFlask',
  Bug: 'tablerBug',
};

/// The `Go to KEY` item shown instantly (before the debounced lookup) when the query is a key, so
/// typing a key and pressing Enter jumps without waiting for the server. A scope keeps only its own
/// kind of key (`p:` doc keys, `t:` ticket keys).
export function keyJumpItem(
  query: string,
  navigate: (url: string) => void,
  scope: string | null = null,
): PaletteItem | null {
  const key = query.trim().toUpperCase();
  const project = key.slice(0, key.indexOf('-'));
  let url: string | null = null;
  if (TICKET_KEY_PATTERN.test(key)) url = `/tickets/${key}`;
  else if (TEST_CASE_KEY_PATTERN.test(key)) url = `/projects/${project}/test-cases/${key}`;
  else if (REGRESSION_SESSION_KEY_PATTERN.test(key))
    url = `/projects/${project}/regressions/${key}`;
  else if (DOC_KEY_PATTERN.test(key)) url = `/docs/${key}`;
  if (!url) return null;
  if (scope === DOCS_SCOPE.id && !DOC_KEY_PATTERN.test(key)) return null;
  if (scope === TICKETS_SCOPE.id && !TICKET_KEY_PATTERN.test(key)) return null;
  const target = url;
  return {
    id: `jump:${key}`,
    label: `Go to ${key}`,
    group: 'Jump to',
    icon: 'tablerArrowRight',
    hint: 'Enter',
    run: () => navigate(target),
  };
}

export function toPaletteItem(
  item: QuickJumpItem,
  navigate: (url: string) => void,
  query = '',
): PaletteItem {
  if (item.kind === 'Doc') {
    return {
      id: `Doc:${item.key}`,
      label: item.title,
      labelHighlights: queryRanges(item.title, query),
      detail: docLocation(item.projectKey, item.folderPath ?? ''),
      snippet: item.snippet ?? undefined,
      group: DOCS_GROUP,
      icon: docKindIcon(item.docKind ?? 'Page', item.diagramFormat ?? null),
      hint: item.key,
      run: () => navigate(item.url),
    };
  }
  return {
    id: `${item.kind}:${item.key}`,
    label: `${item.key}  ${item.title}`,
    group: GROUPS[item.kind],
    icon: item.ticketType ? TYPE_ICONS[item.ticketType] : ICONS[item.kind],
    hint: item.projectKey,
    run: () => navigate(item.url),
  };
}

/// A recently viewed doc as a palette row (shown while the query is empty).
export function recentDocItem(doc: RecentDoc, navigate: (url: string) => void): PaletteItem {
  return {
    id: `recent-doc:${doc.key}`,
    label: doc.title,
    detail: docLocation(doc.projectKey, doc.folderPath),
    group: 'Recent docs',
    icon: docKindIcon(doc.kind, doc.diagramFormat),
    hint: doc.key,
    run: () => navigate(doc.url),
  };
}

/// "PAY · Architecture / ADRs": the project key and the folder path, shown muted beside a doc title.
export function docLocation(projectKey: string, folderPath: string): string {
  if (!folderPath) return projectKey;
  const readable = folderPath.replace(/(?<!\\)\//g, ' / ').replace(/\\(.)/g, '$1');
  return `${projectKey} · ${readable}`;
}

/// The "Search tickets/docs for …" rows that open the search page; a scope keeps only its own.
export function searchPageItems(
  text: string,
  scope: string | null,
  open: (queryParams: Record<string, string>) => void,
): PaletteItem[] {
  const items: PaletteItem[] = [];
  if (scope !== DOCS_SCOPE.id)
    items.push({
      id: 'search:open',
      label: `Search tickets for “${text}”`,
      group: 'Search',
      icon: 'tablerSearch',
      run: () => open({ q: text }),
    });
  if (scope !== TICKETS_SCOPE.id)
    items.push({
      id: 'search:docs',
      label: `Search docs for “${text}”`,
      group: 'Search',
      icon: 'tablerSearch',
      run: () => open({ scope: 'docs', q: text }),
    });
  return items;
}

/// Command palette providers (I-04, spec 12.7): an instant key jump, recent docs for an empty
/// query, the server lookup (exact keys first, then the top 10 ticket titles and the top 5 docs
/// across readable projects), and "Search … for" items that open the search page. Under the
/// `p:` / `t:` scopes the lookup keeps only docs or only tickets (up to 20).
export function quickJumpProviders(): SearchProvider[] {
  const api = inject(ApiClient);
  const router = inject(Router);
  const recentDocs = inject(RecentDocs);
  const navigate = (url: string) => void router.navigateByUrl(url);

  return [
    {
      id: 'search.key-jump',
      minQueryLength: 4,
      scopes: [DOCS_SCOPE.id, TICKETS_SCOPE.id],
      search: (query, _signal, scope) => {
        const item = keyJumpItem(query, navigate, scope);
        return item ? [item] : [];
      },
    },
    {
      id: 'search.recent-docs',
      scopes: [DOCS_SCOPE.id],
      search: (query) =>
        query.trim() ? [] : recentDocs.items().map((doc) => recentDocItem(doc, navigate)),
    },
    {
      id: 'search.quick-jump',
      remote: true,
      minQueryLength: 1,
      scopes: [DOCS_SCOPE.id, TICKETS_SCOPE.id],
      search: async (query, signal, scope) => {
        const text = query.trim();
        const searchItems = searchPageItems(
          text,
          scope,
          (queryParams) => void router.navigate(['/search'], { queryParams }),
        );
        const params: Record<string, string> = { q: text };
        if (scope && API_SCOPES[scope]) params['scope'] = API_SCOPES[scope];
        let items: QuickJumpItem[];
        try {
          items = await firstValueFrom(
            api
              .get<QuickJumpItem[]>('/quick-jump', params)
              .pipe(takeUntil(fromEvent(signal, 'abort'))),
            {
              defaultValue: [] as QuickJumpItem[],
            },
          );
        } catch {
          items = [];
        }
        const jumped = keyJumpItem(text, navigate, scope) ? text.toUpperCase() : null;
        return [
          ...items.filter((i) => i.key !== jumped).map((i) => toPaletteItem(i, navigate, text)),
          ...searchItems,
        ];
      },
    },
  ];
}
