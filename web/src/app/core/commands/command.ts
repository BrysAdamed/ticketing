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
  /// Minimum trimmed query length before `search` is called (default 0).
  minQueryLength?: number;
  search(
    query: string,
    signal: AbortSignal,
  ): readonly PaletteItem[] | Promise<readonly PaletteItem[]>;
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
