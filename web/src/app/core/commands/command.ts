/// A named action the user can run from the command palette, a button or a shortcut
/// (for example `ticket.create`). Registered with `CommandRegistry.registerCommands`.
export interface Command {
  id: string;
  label: string;
  group?: string;
  icon?: string;
  /// Shortcut shown next to the item (display only; bind keys with ShortcutService).
  shortcut?: string;
  keywords?: readonly string[];
  run: () => void;
  /// Hide the command when this returns false (evaluated each time the palette renders).
  available?: () => boolean;
}

/// A part of a palette text to emphasise (UTF-16 `start` and `length`).
export interface PaletteRange {
  start: number;
  length: number;
}

/// One row in the command palette results. A row with `detail` or `snippet` is drawn on two lines:
/// the label with `detail` muted beside it, then the snippet with its matches emphasised.
export interface PaletteItem {
  id: string;
  label: string;
  group: string;
  icon?: string;
  hint?: string;
  shortcut?: string;
  labelHighlights?: readonly PaletteRange[];
  detail?: string;
  snippet?: { text: string; highlights: readonly PaletteRange[] };
  run: () => void;
}

/// Contributes palette results for a query (tickets, projects, boards, …). Local providers run on
/// every keystroke; `remote` providers (API calls) run after a 120 ms debounce. The AbortSignal
/// fires when the query changes or the palette closes.
export interface SearchProvider {
  id: string;
  remote?: boolean;
  /// Minimum trimmed query length (without a scope prefix) before `search` is called (default 0).
  minQueryLength?: number;
  /// Ids of the palette scopes this provider also answers; without them it runs for unscoped queries only.
  scopes?: readonly string[];
  /// `query` comes without the scope prefix; `scope` is the active scope's id, or null.
  search(
    query: string,
    signal: AbortSignal,
    scope: string | null,
  ): readonly PaletteItem[] | Promise<readonly PaletteItem[]>;
}

/// A query prefix that narrows the palette to one kind of result (`p:` docs, `t:` tickets). While it
/// leads the query, commands are hidden and only providers listing the scope's `id` run. Its `hint`
/// is shown in the palette footer.
export interface PaletteScope {
  id: string;
  prefix: string;
  hint: string;
}

export interface PaletteQuery {
  text: string;
  scope: PaletteScope | null;
}

/// Splits a leading scope prefix (any case, leading spaces ignored) off a palette query.
export function parsePaletteQuery(query: string, scopes: readonly PaletteScope[]): PaletteQuery {
  const trimmed = query.trimStart();
  const lower = trimmed.toLowerCase();
  const scope = scopes.find((s) => lower.startsWith(s.prefix.toLowerCase()));
  return scope
    ? { scope, text: trimmed.slice(scope.prefix.length).trimStart() }
    : { scope: null, text: query };
}

/// Subsequence match score (higher is better), or -1 when `query` doesn't match `text`.
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = text.toLowerCase();
  if (t === q) return 1000;
  if (t.startsWith(q)) return 800 - t.length;
  const wordStart = t.indexOf(` ${q}`);
  if (wordStart >= 0) return 600 - wordStart;
  const index = t.indexOf(q);
  if (index >= 0) return 400 - index;
  let ti = 0;
  let gaps = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return -1;
    gaps += found - ti;
    ti = found + 1;
  }
  return Math.max(1, 200 - gaps);
}
