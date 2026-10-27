import { diffArrays } from 'diff';

/// Lines `[start, end)` of one side's text that clash with the other side.
export interface LineRange {
  start: number;
  end: number;
}

export interface MergeConflict {
  mine: LineRange;
  theirs: LineRange;
}

export type MergeResult =
  { clean: true; text: string } | { clean: false; conflicts: readonly MergeConflict[] };

interface Hunk {
  start: number;
  end: number;
  lines: string[];
}

interface Group {
  start: number;
  end: number;
  mine: Hunk[];
  theirs: Hunk[];
}

/// Line-based 3-way merge of `mine` and `theirs`, both edited from `base` (spec 1.7). Changes to
/// different parts merge; changes that overlap or touch (no unchanged line between them) conflict
/// unless both sides made the same change. Conflict ranges are line indices in `mine` and `theirs`.
export function mergeThreeWay(base: string, mine: string, theirs: string): MergeResult {
  const baseLines = lines(base);
  const mineLines = lines(mine);
  const theirsLines = lines(theirs);
  const groups = groupHunks(hunks(baseLines, mineLines), hunks(baseLines, theirsLines));

  const merged: string[] = [];
  const conflicts: MergeConflict[] = [];
  let position = 0;
  let mineShift = 0;
  let theirsShift = 0;
  for (const group of groups) {
    merged.push(...baseLines.slice(position, group.start));
    const mineText = apply(baseLines, group.start, group.end, group.mine);
    const theirsText = apply(baseLines, group.start, group.end, group.theirs);
    if (group.theirs.length === 0 || sameLines(mineText, theirsText)) merged.push(...mineText);
    else if (group.mine.length === 0) merged.push(...theirsText);
    else
      conflicts.push({
        mine: { start: group.start + mineShift, end: group.start + mineShift + mineText.length },
        theirs: {
          start: group.start + theirsShift,
          end: group.start + theirsShift + theirsText.length,
        },
      });
    mineShift += mineText.length - (group.end - group.start);
    theirsShift += theirsText.length - (group.end - group.start);
    position = group.end;
  }
  merged.push(...baseLines.slice(position));

  return conflicts.length === 0
    ? { clean: true, text: merged.join('\n') }
    : { clean: false, conflicts };
}

function lines(text: string): string[] {
  return text.replace(/\r\n?/g, '\n').split('\n');
}

/// The edits that turn `base` into `other`: base ranges and their replacement lines.
function hunks(base: string[], other: string[]): Hunk[] {
  const result: Hunk[] = [];
  let position = 0;
  let current: Hunk | null = null;
  for (const change of diffArrays(base, other)) {
    if (!change.added && !change.removed) {
      if (current) result.push(current);
      current = null;
      position += change.value.length;
      continue;
    }
    current ??= { start: position, end: position, lines: [] };
    if (change.removed) {
      position += change.value.length;
      current.end = position;
    } else {
      current.lines.push(...change.value);
    }
  }
  if (current) result.push(current);
  return result;
}

/// Joins hunks of both sides whose base ranges overlap or touch into groups, in base order.
function groupHunks(mine: Hunk[], theirs: Hunk[]): Group[] {
  const all = [
    ...mine.map((hunk) => ({ hunk, side: 'mine' as const })),
    ...theirs.map((hunk) => ({ hunk, side: 'theirs' as const })),
  ].sort((a, b) => a.hunk.start - b.hunk.start || a.hunk.end - b.hunk.end);

  const groups: Group[] = [];
  for (const { hunk, side } of all) {
    const last = groups.at(-1);
    if (last && hunk.start <= last.end) {
      last.end = Math.max(last.end, hunk.end);
      last[side].push(hunk);
    } else {
      groups.push({
        start: hunk.start,
        end: hunk.end,
        mine: side === 'mine' ? [hunk] : [],
        theirs: side === 'theirs' ? [hunk] : [],
      });
    }
  }
  return groups;
}

/// One side's text for the base range `[start, end)`: base lines with that side's hunks applied.
function apply(base: string[], start: number, end: number, sideHunks: Hunk[]): string[] {
  const result: string[] = [];
  let position = start;
  for (const hunk of sideHunks) {
    result.push(...base.slice(position, hunk.start), ...hunk.lines);
    position = hunk.end;
  }
  result.push(...base.slice(position, end));
  return result;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}
