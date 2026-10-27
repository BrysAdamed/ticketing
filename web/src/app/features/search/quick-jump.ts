import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { PaletteItem, SearchProvider } from '@core/commands/command';
import { docKindIcon, DocSearchFormat, DocSearchKind, DocSnippet } from '@core/docs/doc-search.api';
import { RecentDoc, RecentDocs } from '@core/docs/recent-docs';
import { TicketType } from '@shared/domain/enums';
import {
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
  docKind?: DocSearchKind | null;
  diagramFormat?: DocSearchFormat | null;
  folderPath?: string | null;
  snippet?: DocSnippet | null;
}

const DOC_KEY = /^[A-Z][A-Z0-9]{1,9}-D-\d+$/;
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
/// typing a key and pressing Enter jumps without waiting for the server.
export function keyJumpItem(query: string, navigate: (url: string) => void): PaletteItem | null {
  const key = query.trim().toUpperCase();
  const project = key.slice(0, key.indexOf('-'));
  let url: string | null = null;
  if (TICKET_KEY_PATTERN.test(key)) url = `/tickets/${key}`;
  else if (TEST_CASE_KEY_PATTERN.test(key)) url = `/projects/${project}/test-cases/${key}`;
  else if (REGRESSION_SESSION_KEY_PATTERN.test(key))
    url = `/projects/${project}/regressions/${key}`;
  else if (DOC_KEY.test(key)) url = `/docs/${key}`;
  if (!url) return null;
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

/// Command palette providers (I-04, spec 12.7): an instant key jump, recent docs for an empty
/// query, the server lookup (exact keys first, then the top 10 ticket titles and the top 5 docs
/// across readable projects), and "Search … for" items that open the search page.
export function quickJumpProviders(): SearchProvider[] {
  const api = inject(ApiClient);
  const router = inject(Router);
  const recentDocs = inject(RecentDocs);
  const navigate = (url: string) => void router.navigateByUrl(url);

  return [
    {
      id: 'search.key-jump',
      minQueryLength: 4,
      search: (query) => {
        const item = keyJumpItem(query, navigate);
        return item ? [item] : [];
      },
    },
    {
      id: 'search.recent-docs',
      search: (query) =>
        query.trim() ? [] : recentDocs.items().map((doc) => recentDocItem(doc, navigate)),
    },
    {
      id: 'search.quick-jump',
      remote: true,
      minQueryLength: 1,
      search: async (query, signal) => {
        const text = query.trim();
        const searchItems: PaletteItem[] = [
          {
            id: 'search:open',
            label: `Search tickets for “${text}”`,
            group: 'Search',
            icon: 'tablerSearch',
            run: () => void router.navigate(['/search'], { queryParams: { q: text } }),
          },
          {
            id: 'search:docs',
            label: `Search docs for “${text}”`,
            group: 'Search',
            icon: 'tablerSearch',
            run: () =>
              void router.navigate(['/search'], { queryParams: { scope: 'docs', q: text } }),
          },
        ];
        let items: QuickJumpItem[];
        try {
          items = await firstValueFrom(
            api
              .get<QuickJumpItem[]>('/quick-jump', { q: text })
              .pipe(takeUntil(fromEvent(signal, 'abort'))),
            {
              defaultValue: [] as QuickJumpItem[],
            },
          );
        } catch {
          items = [];
        }
        const jumped = keyJumpItem(text, navigate) ? text.toUpperCase() : null;
        return [
          ...items.filter((i) => i.key !== jumped).map((i) => toPaletteItem(i, navigate, text)),
          ...searchItems,
        ];
      },
    },
  ];
}
