/// A piece of text and whether it is a match.
export interface HighlightSegment {
  text: string;
  mark: boolean;
}

/// Splits `text` into plain and marked segments from `ranges` (UTF-16 `start`/`length`). Ranges
/// are clamped to the text, sorted and merged when they overlap or touch, so any server input is safe.
export function highlightSegments(
  text: string,
  ranges: readonly { start: number; length: number }[],
): HighlightSegment[] {
  const spans = ranges
    .map((r) => [Math.max(0, r.start), Math.min(text.length, r.start + r.length)] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const segments: HighlightSegment[] = [];
  let at = 0;
  for (const [start, end] of merged) {
    if (start > at) segments.push({ text: text.slice(at, start), mark: false });
    segments.push({ text: text.slice(start, end), mark: true });
    at = end;
  }
  if (at < text.length || !segments.length) segments.push({ text: text.slice(at), mark: false });
  return segments;
}

/// Ranges where any word of `query` (2+ characters) occurs in `text`, case-insensitively. Used to
/// emphasise the match in a title, where the server sends no ranges.
export function queryRanges(text: string, query: string): { start: number; length: number }[] {
  const lower = text.toLowerCase();
  const words = query
    .toLowerCase()
    .split(/[\s"'()-]+/)
    .filter((w) => w.length >= 2);
  const ranges: { start: number; length: number }[] = [];
  for (const word of words) {
    for (let i = lower.indexOf(word); i >= 0; i = lower.indexOf(word, i + word.length))
      ranges.push({ start: i, length: word.length });
  }
  return ranges;
}
