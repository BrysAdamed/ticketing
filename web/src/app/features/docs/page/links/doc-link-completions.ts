import {
  Completion,
  CompletionContext,
  CompletionResult,
  startCompletion,
} from '@codemirror/autocomplete';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { markdownCompletions } from '../../editing/codemirror-markdown';

/// A doc the `[[` picker offers.
export interface DocLinkOption {
  key: string;
  projectKey: string;
  title: string;
  where: string;
}

/// A ticket the `#` picker offers.
export interface TicketLinkOption {
  key: string;
  projectKey: string;
  title: string;
  status: string | null;
}

export interface DocLinkCompletionDeps {
  docKey: string;
  projectKey: string;
  /// Docs whose title matches `query` (recent docs of the project for an empty query).
  findDocs(query: string, signal: AbortSignal): Promise<DocLinkOption[]>;
  /// Tickets whose key or title matches `query` (never called with an empty query).
  findTickets(query: string, signal: AbortSignal): Promise<TicketLinkOption[]>;
}

const DEBOUNCE_MS = 120;
const DOC_TRIGGER = /\[\[[^\]\n[]{0,80}$/;
const TICKET_TRIGGER = /(?:^|[\s([])#[A-Za-z0-9][\w-]{0,60}$|(?:^|[\s([])#$/;

/// The `[[` doc picker and the `#` ticket picker of the page editor (spec 1.8): `[[` + title text
/// offers readable docs, the current project first, and inserts `[Title](KEY)`; `#` + key or title
/// text offers tickets and inserts the key. Inserting `[[` or `#` from a toolbar button opens them.
export function docLinkCompletions(deps: DocLinkCompletionDeps): Extension[] {
  return [
    markdownCompletions.of((context) => docSource(context, deps)),
    markdownCompletions.of((context) => ticketSource(context, deps)),
    EditorView.updateListener.of((update) => {
      const programmatic = update.transactions.some(
        (tr) => tr.isUserEvent('input') && !tr.isUserEvent('input.type'),
      );
      if (!update.docChanged || !programmatic) return;
      const head = update.state.selection.main.head;
      const before = update.state.sliceDoc(Math.max(0, head - 2), head);
      if (before === '[[' || before.endsWith('#')) setTimeout(() => startCompletion(update.view));
    }),
  ];
}

/// Puts docs of `projectKey` first, keeping the order within each group.
export function currentProjectFirst<T extends { projectKey: string }>(
  items: readonly T[],
  projectKey: string,
): T[] {
  return [
    ...items.filter((i) => i.projectKey === projectKey),
    ...items.filter((i) => i.projectKey !== projectKey),
  ];
}

/// The markdown link `[[` inserts: brackets in the title are escaped.
export function docLinkMarkdown(option: { key: string; title: string }): string {
  return `[${option.title.replace(/([[\]\\])/g, '\\$1')}](${option.key})`;
}

async function docSource(
  context: CompletionContext,
  deps: DocLinkCompletionDeps,
): Promise<CompletionResult | null> {
  const match = context.matchBefore(DOC_TRIGGER);
  if (!match) return null;
  const query = match.text.slice(2).trim();
  const docs = await debounced(context, (signal) => deps.findDocs(query, signal));
  if (!docs) return null;
  const options = currentProjectFirst(
    docs.filter((d) => d.key !== deps.docKey),
    deps.projectKey,
  ).map((doc): Completion => ({
    label: doc.title,
    detail: `${doc.key}${doc.where ? ` · ${doc.where}` : ''}`,
    type: 'text',
    apply: (view, _completion, from, to) => {
      const closing = view.state.sliceDoc(to, to + 2) === ']]' ? 2 : 0;
      const insert = docLinkMarkdown(doc);
      view.dispatch({
        changes: { from, to: to + closing, insert },
        selection: { anchor: from + insert.length },
        userEvent: 'input.complete',
      });
    },
  }));
  return {
    from: match.from,
    filter: false,
    options: options.length
      ? options
      : [noMatch(query ? `No docs match “${query}”` : 'No docs yet')],
  };
}

async function ticketSource(
  context: CompletionContext,
  deps: DocLinkCompletionDeps,
): Promise<CompletionResult | null> {
  const match = context.matchBefore(TICKET_TRIGGER);
  if (!match) return null;
  const hash = match.text.lastIndexOf('#');
  const query = match.text.slice(hash + 1);
  const from = match.from + hash;
  if (!query) {
    return context.explicit
      ? { from, filter: false, options: [noMatch('Type a ticket key or title')] }
      : null;
  }
  const tickets = await debounced(context, (signal) => deps.findTickets(query, signal));
  if (!tickets) return null;
  const options = currentProjectFirst(tickets, deps.projectKey).map((ticket): Completion => ({
    label: ticket.key,
    detail: ticket.title,
    type: 'text',
    apply: ticket.key,
  }));
  return {
    from,
    filter: false,
    options: options.length ? options : [noMatch(`No tickets match “${query}”`)],
  };
}

/// A completion row that only says why there is nothing to pick; choosing it inserts nothing.
export function noMatch(label: string): Completion {
  return { label, type: 'text', apply: (view) => view.focus(), boost: -99 };
}

/// Runs `load` after a short pause unless the completion was aborted meanwhile; null when aborted or failed.
export async function debounced<T>(
  context: CompletionContext,
  load: (signal: AbortSignal) => Promise<T>,
): Promise<T | null> {
  const controller = new AbortController();
  context.addEventListener('abort', () => controller.abort());
  await new Promise((resolve) => setTimeout(resolve, DEBOUNCE_MS));
  if (context.aborted) return null;
  try {
    return await load(controller.signal);
  } catch {
    return null;
  }
}
