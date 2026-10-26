import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { PaletteItem, SearchProvider } from '@core/commands/command';
import { TicketType } from '@shared/domain/enums';
import { REGRESSION_SESSION_KEY_PATTERN, TEST_CASE_KEY_PATTERN, TICKET_KEY_PATTERN } from '@shared/domain/keys';

/// Item of `GET /api/v1/quick-jump?q=`.
export interface QuickJumpItem {
  kind: 'Ticket' | 'TestCase' | 'RegressionSession';
  id: string;
  key: string;
  title: string;
  projectKey: string;
  url: string;
  ticketType: TicketType | null;
  status: string;
}

const GROUPS: Record<QuickJumpItem['kind'], string> = { Ticket: 'Tickets', TestCase: 'Test cases', RegressionSession: 'Regressions' };
const ICONS: Record<QuickJumpItem['kind'], string> = { Ticket: 'tablerFileText', TestCase: 'tablerChecklist', RegressionSession: 'tablerListCheck' };
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
  else if (REGRESSION_SESSION_KEY_PATTERN.test(key)) url = `/projects/${project}/regressions/${key}`;
  if (!url) return null;
  const target = url;
  return { id: `jump:${key}`, label: `Go to ${key}`, group: 'Jump to', icon: 'tablerArrowRight', hint: 'Enter', run: () => navigate(target) };
}

export function toPaletteItem(item: QuickJumpItem, navigate: (url: string) => void): PaletteItem {
  return {
    id: `${item.kind}:${item.key}`,
    label: `${item.key}  ${item.title}`,
    group: GROUPS[item.kind],
    icon: item.ticketType ? TYPE_ICONS[item.ticketType] : ICONS[item.kind],
    hint: item.projectKey,
    run: () => navigate(item.url),
  };
}

/// Command palette providers (I-04): an instant key jump, the server lookup (exact keys first, then
/// the top 10 titles across readable projects), and "Search for …" that opens the search page.
export function quickJumpProviders(): SearchProvider[] {
  const api = inject(ApiClient);
  const router = inject(Router);
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
      id: 'search.quick-jump',
      remote: true,
      minQueryLength: 1,
      search: async (query, signal) => {
        const text = query.trim();
        const searchItem: PaletteItem = {
          id: 'search:open',
          label: `Search tickets for “${text}”`,
          group: 'Search',
          icon: 'tablerSearch',
          run: () => void router.navigate(['/search'], { queryParams: { q: text } }),
        };
        let items: QuickJumpItem[] = [];
        try {
          items = await firstValueFrom(api.get<QuickJumpItem[]>('/quick-jump', { q: text }).pipe(takeUntil(fromEvent(signal, 'abort'))), {
            defaultValue: [] as QuickJumpItem[],
          });
        } catch {
          items = [];
        }
        const jumped = keyJumpItem(text, navigate) ? text.toUpperCase() : null;
        return [...items.filter((i) => i.key !== jumped).map((i) => toPaletteItem(i, navigate)), searchItem];
      },
    },
  ];
}