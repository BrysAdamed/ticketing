import { EnvironmentProviders, inject, Provider } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { tablerFileText, tablerHash } from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { provideDocEditorPlugin, provideDocPageSection } from '@core/docs/doc-extensions';
import { DocSearchApi } from '@core/docs/doc-search.api';
import { DocsApi } from '@core/docs/docs.api';
import type { DocLinkOption, TicketLinkOption } from './doc-link-completions';

const PICKER_LIMIT = 20;

interface TicketHit {
  key: string;
  projectKey: string;
  title: string;
  status: string | null;
}

/// Doc links (TKT-16): the "Tickets mentioned" and "Linked from" page sections and the editor's
/// `[[` doc picker and `#` ticket picker, with a toolbar button and a slash command for each.
export function provideDocLinks(): (Provider | EnvironmentProviders)[] {
  return [
    provideIcons({ tablerFileText, tablerHash }),
    provideDocPageSection({
      id: 'tickets',
      order: 20,
      placement: 'footer',
      loadComponent: () =>
        import('./doc-tickets-section.component').then((m) => m.DocTicketsSectionComponent),
    }),
    provideDocPageSection({
      id: 'backlinks',
      order: 30,
      placement: 'footer',
      loadComponent: () =>
        import('./doc-backlinks-section.component').then((m) => m.DocBacklinksSectionComponent),
    }),
    provideDocEditorPlugin(() => {
      const docs = inject(DocsApi);
      const search = inject(DocSearchApi);
      const api = inject(ApiClient);
      const findDocs = async (query: string, projectKey: string): Promise<DocLinkOption[]> => {
        if (!query) {
          const recent = await firstValueFrom(docs.recent(projectKey, 8));
          return recent.map((d) => ({ ...d, where: d.path }));
        }
        const page = await firstValueFrom(search.search({ q: query, limit: PICKER_LIMIT }));
        return page.items.map((d) => ({
          key: d.key,
          projectKey: d.projectKey,
          title: d.title,
          where: `${d.projectKey}${d.folderPath ? ` · ${d.folderPath}` : ''}`,
        }));
      };
      const findTickets = async (query: string): Promise<TicketLinkOption[]> => {
        const hits = await firstValueFrom(
          api.get<TicketHit[]>('/quick-jump', { q: query, scope: 'Tickets' }),
        );
        return hits.map(({ key, projectKey, title, status }) => ({
          key,
          projectKey,
          title,
          status,
        }));
      };
      return {
        id: 'links',
        order: 20,
        toolbar: [
          {
            id: 'link-doc',
            label: 'Link a doc',
            icon: 'tablerFileText',
            hint: '[[',
            run: (context) => context.replaceSelection(`[[${context.selectedText()}`),
          },
          {
            id: 'link-ticket',
            label: 'Mention a ticket',
            icon: 'tablerHash',
            hint: '#',
            run: (context) => context.replaceSelection(`#${context.selectedText()}`),
          },
        ],
        slashCommands: [
          {
            id: 'link-doc',
            label: 'Doc link',
            icon: 'tablerFileText',
            hint: '[[',
            run: (context) => context.replaceSelection('[['),
          },
          {
            id: 'link-ticket',
            label: 'Ticket mention',
            icon: 'tablerHash',
            hint: '#',
            run: (context) => context.replaceSelection('#'),
          },
        ],
        extensions: ({ docKey, projectKey }) =>
          import('./doc-link-completions').then((m) =>
            m.docLinkCompletions({
              docKey,
              projectKey,
              findDocs: (query) => findDocs(query, projectKey),
              findTickets,
            }),
          ),
      };
    }),
  ];
}
