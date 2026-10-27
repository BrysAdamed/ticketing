/// One entry of "On this page": a heading of the rendered page.
export interface OutlineEntry {
  id: string;
  text: string;
  /// 1 for the shallowest heading level used on the page, 2 and 3 below it.
  depth: number;
}

/// The h1–h3 headings with ids under `root`, in document order, depths relative to the shallowest.
export function extractOutline(root: ParentNode): OutlineEntry[] {
  const headings = Array.from(root.querySelectorAll('h1[id], h2[id], h3[id]'));
  const levels = headings.map((h) => Number(h.tagName.slice(1)));
  const top = Math.min(...levels);
  return headings.map((heading, i) => ({
    id: heading.id,
    text: (heading.textContent ?? '').trim(),
    depth: levels[i] - top + 1,
  }));
}

/// Scroll spy: the id of the last heading whose top is at or above `offset` px from the top of
/// the scroll container (`tops` are viewport-relative tops, `containerTop` the container's).
export function activeHeading(
  entries: readonly { id: string; top: number }[],
  containerTop: number,
  offset = 72,
): string | null {
  let active: string | null = entries[0]?.id ?? null;
  for (const entry of entries) {
    if (entry.top - containerTop <= offset) active = entry.id;
    else break;
  }
  return active;
}

/// Source line → preview scroll position for the editor's synced preview: the ATX headings
/// outside code fences anchor the two panes, positions between them are interpolated.
export function headingLines(source: string): number[] {
  const lines: number[] = [];
  let fence: string | null = null;
  source.split('\n').forEach((line, index) => {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker[0];
      else if (marker[0] === fence) fence = null;
      return;
    }
    if (!fence && /^\s{0,3}#{1,6}(\s|$)/.test(line)) lines.push(index);
  });
  return lines;
}

/// Where the preview should scroll so it shows what the source shows at `line`.
/// `sourceAnchors` are heading line numbers, `previewAnchors` the headings' offsets in the
/// preview (same count, else a proportional fallback); `totalLines` and `previewHeight` close the
/// last segment.
export function syncedScrollTop(
  line: number,
  sourceAnchors: readonly number[],
  previewAnchors: readonly number[],
  totalLines: number,
  previewHeight: number,
): number {
  if (totalLines <= 1) return 0;
  if (sourceAnchors.length === 0 || sourceAnchors.length !== previewAnchors.length)
    return (line / (totalLines - 1)) * previewHeight;
  const sources = [0, ...sourceAnchors, totalLines - 1];
  const targets = [0, ...previewAnchors, previewHeight];
  for (let i = sources.length - 2; i >= 0; i--) {
    if (line < sources[i]) continue;
    const span = sources[i + 1] - sources[i];
    const ratio = span > 0 ? Math.min(1, (line - sources[i]) / span) : 0;
    return targets[i] + ratio * (targets[i + 1] - targets[i]);
  }
  return 0;
}
