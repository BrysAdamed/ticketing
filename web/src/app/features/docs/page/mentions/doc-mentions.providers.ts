import { EnvironmentProviders, inject, Injectable, Provider, signal } from '@angular/core';
import { provideIcons } from '@ng-icons/core';
import { tablerAt } from '@ng-icons/tabler-icons';
import { provideDocEditorPlugin } from '@core/docs/doc-extensions';
import { ProjectPeople } from '@core/tickets/project-people';
import { MentionUser } from '@shared/markdown/mentions';

/// Users picked with `@` in the page editor since it opened, so the preview shows their chips
/// before the server has resolved them (the reader gets them from `Doc.mentions`).
@Injectable()
export class DocMentionPicks {
  private readonly picked = signal<readonly MentionUser[]>([]);

  readonly users = this.picked.asReadonly();

  add(user: MentionUser): void {
    if (this.picked().some((u) => u.id === user.id)) return;
    this.picked.update((users) => [...users, user]);
  }
}

/// @mentions in pages (TKT-109, D-166): the editor's `@` people picker with a toolbar button and
/// a slash command. The server checks and notifies mentions when the page is published.
export function provideDocMentions(): (Provider | EnvironmentProviders)[] {
  return [
    DocMentionPicks,
    provideIcons({ tablerAt }),
    provideDocEditorPlugin(() => {
      const people = inject(ProjectPeople);
      const picks = inject(DocMentionPicks);
      return {
        id: 'mentions',
        order: 30,
        toolbar: [
          {
            id: 'mention-person',
            label: 'Mention someone',
            icon: 'tablerAt',
            hint: '@',
            run: (context) => context.replaceSelection('@'),
          },
        ],
        slashCommands: [
          {
            id: 'mention-person',
            label: 'Mention someone',
            icon: 'tablerAt',
            hint: '@',
            run: (context) => context.replaceSelection('@'),
          },
        ],
        extensions: async ({ projectKey }) => {
          const { docMentionCompletions } = await import('./doc-mention-completions');
          return docMentionCompletions({
            search: people.mentionSearch(() => projectKey),
            picked: (user) => picks.add(user),
          });
        },
      };
    }),
  ];
}
