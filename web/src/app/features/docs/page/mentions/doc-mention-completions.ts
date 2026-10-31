import {
  Completion,
  CompletionContext,
  CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  findMentionQuery,
  formatMention,
  MentionCandidate,
  MentionSearch,
} from '@shared/markdown/mentions';
import { markdownCompletions } from '../../editing/codemirror-markdown';
import { debounced, noMatch } from '../links/doc-link-completions';

export interface DocMentionCompletionDeps {
  /// Active users who can read the project (`GET /users?access=read`).
  search: MentionSearch;
  /// Called with each user picked, so the preview can show their chip before the page is published.
  picked(user: MentionCandidate): void;
}

/// The `@` people picker of the page editor (D-166): `@` + name or email text, outside code, offers
/// the project's readers and inserts `@[Name](user:<id>)` plus a space, like the ticket editors (D-96).
export function docMentionCompletions(deps: DocMentionCompletionDeps): Extension[] {
  return [
    markdownCompletions.of((context) => mentionSource(context, deps)),
    EditorView.updateListener.of((update) => {
      const programmatic = update.transactions.some(
        (tr) => tr.isUserEvent('input') && !tr.isUserEvent('input.type'),
      );
      if (!update.docChanged || !programmatic) return;
      const head = update.state.selection.main.head;
      if (update.state.sliceDoc(head - 1, head) === '@')
        setTimeout(() => startCompletion(update.view));
    }),
  ];
}

export async function mentionSource(
  context: CompletionContext,
  deps: DocMentionCompletionDeps,
): Promise<CompletionResult | null> {
  const before = context.state.sliceDoc(0, context.pos);
  const query = findMentionQuery(before, before.length);
  if (!query) return null;
  const users = await debounced(context, (signal) => deps.search(query.query, signal));
  if (!users) return null;
  const options = users.map((user): Completion => ({
    label: user.displayName,
    detail: user.email,
    type: 'text',
    apply: (view: EditorView, _completion: Completion, _from: number, to: number) => {
      const token = formatMention(user.id, user.displayName);
      const insert = /^\s/.test(view.state.sliceDoc(to, to + 1)) ? token : `${token} `;
      view.dispatch({
        changes: { from: query.start, to, insert },
        selection: { anchor: query.start + insert.length },
        userEvent: 'input.complete',
      });
      deps.picked(user);
    },
  }));
  return {
    from: query.start + 1,
    filter: false,
    options: options.length
      ? options
      : [noMatch(query.query ? `Nobody matches “${query.query}”` : 'Type a name or email')],
  };
}
