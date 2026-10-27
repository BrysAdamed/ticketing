/// A placeholder a template may use, for the `{{` completion list.
export interface TemplatePlaceholder {
  name: string;
  description: string;
}

/// A template problem; `line` and `column` are 1-based and null for problems of the whole text
/// (for example the length limit).
export interface TemplateIssue {
  code: string;
  message: string;
  line: number | null;
  column: number | null;
}

/// The placeholder being typed at `caret`: an open `{{` on the same line followed only by name
/// characters. `start` is the index of the `{{`.
export function placeholderQuery(
  text: string,
  caret: number,
): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /\{\{\s*([A-Za-z0-9_.]*)$/.exec(before);
  if (!match) return null;
  return { start: match.index, query: match[1] };
}

/// Placeholders whose name contains the query (prefix matches first).
export function matchPlaceholders(
  placeholders: readonly TemplatePlaceholder[],
  query: string,
): TemplatePlaceholder[] {
  const q = query.toLowerCase();
  const matches = placeholders.filter((p) => p.name.toLowerCase().includes(q));
  return [
    ...matches.filter((p) => p.name.toLowerCase().startsWith(q)),
    ...matches.filter((p) => !p.name.toLowerCase().startsWith(q)),
  ];
}

/// Replaces the `{{query` before the caret with `{{name}}`, reusing a `}}` that already follows the
/// caret. Returns the new text and the caret after the inserted placeholder.
export function insertPlaceholder(
  text: string,
  start: number,
  caret: number,
  name: string,
): { text: string; caret: number } {
  const after = text.slice(caret);
  const closing = /^[A-Za-z0-9_.]*\s*\}\}/.exec(after);
  const rest = closing ? after.slice(closing[0].length) : after;
  const inserted = `{{${name}}}`;
  return { text: text.slice(0, start) + inserted + rest, caret: start + inserted.length };
}

/// A run of characters on one line, marked when an issue points into it.
export interface TemplateSegment {
  text: string;
  issue: TemplateIssue | null;
}

/// Splits the text into lines of segments, marking the token each positioned issue points at: the
/// whole `{{…}}` when the issue starts at one, otherwise the word at the column (at least one
/// character, so an issue at the end of a line stays visible).
export function highlightIssues(
  text: string,
  issues: readonly TemplateIssue[],
): TemplateSegment[][] {
  const lines = text.split('\n');
  return lines.map((line, index) => {
    const ranges = issues
      .filter((i) => i.line === index + 1 && i.column !== null)
      .map((issue) => ({ issue, ...issueRange(line, issue.column! - 1) }))
      .sort((x, y) => x.from - y.from);
    const segments: TemplateSegment[] = [];
    let at = 0;
    for (const range of ranges) {
      if (range.from < at) continue;
      if (range.from > at) segments.push({ text: line.slice(at, range.from), issue: null });
      segments.push({ text: line.slice(range.from, range.to).padEnd(1, ' '), issue: range.issue });
      at = range.to;
    }
    if (at < line.length) segments.push({ text: line.slice(at), issue: null });
    return segments;
  });
}

function issueRange(line: string, from: number): { from: number; to: number } {
  const start = Math.min(Math.max(from, 0), line.length);
  if (line.startsWith('{{', start)) {
    const close = line.indexOf('}}', start + 2);
    return { from: start, to: close < 0 ? line.length : close + 2 };
  }
  const word = /^\S+/.exec(line.slice(start));
  return { from: start, to: start + (word ? word[0].length : 1) };
}
