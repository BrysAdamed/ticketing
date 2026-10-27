import { diffArrays, diffWordsWithSpace } from 'diff';

export type DiffLineKind = 'same' | 'add' | 'del';

/// A piece of a changed line; `changed` pieces are the words that differ from the paired line.
export interface DiffSegment {
  text: string;
  changed: boolean;
}

export interface DiffLine {
  kind: DiffLineKind;
  oldNo: number | null;
  newNo: number | null;
  text: string;
  /// Word highlights for a changed line paired with its counterpart; null shows the line plain.
  segments: DiffSegment[] | null;
}

/// A run of unchanged lines collapsed to "··· n unchanged lines"; `lines` expand it.
export interface DiffFold {
  kind: 'fold';
  lines: DiffLine[];
}

export type DiffRow = DiffLine | DiffFold;

/// One row of the side-by-side view: the old line left, the new one right (either may be absent).
export interface SplitPair {
  kind: 'pair';
  left: DiffLine | null;
  right: DiffLine | null;
}

export type SplitRow = SplitPair | DiffFold;

export interface DocDiff {
  rows: DiffRow[];
  added: number;
  removed: number;
  /// The line diff ran out of time and shows the changed region as removed then added.
  approximate: boolean;
}

export interface DiffOptions {
  /// Unchanged lines kept around each change; longer unchanged runs fold.
  context?: number;
  /// Budget of the line diff in ms before falling back to remove-all/add-all of the changed region.
  timeoutMs?: number;
}

const WORD_DIFF_MAX_LINE = 2_000;
const WORD_DIFF_MAX_PAIRS = 2_000;
const WORD_DIFF_MAX_CHANGED_RATIO = 0.6;

/// Line diff of two versions with word highlights inside paired changed lines (spec 1.6): common
/// head and tail lines are skipped before Myers runs on the rest, so two 100 KB versions with a
/// few edits diff in a few ms; a pathological pair falls back after `timeoutMs`.
export function diffDocs(oldText: string, newText: string, options: DiffOptions = {}): DocDiff {
  const context = options.context ?? 3;
  const before = splitLines(oldText);
  const after = splitLines(newText);

  let head = 0;
  const shortest = Math.min(before.length, after.length);
  while (head < shortest && before[head] === after[head]) head++;
  let tail = 0;
  while (
    tail < shortest - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  )
    tail++;

  const oldMiddle = before.slice(head, before.length - tail);
  const newMiddle = after.slice(head, after.length - tail);
  const replaced = [
    { value: oldMiddle, removed: true, added: false, count: oldMiddle.length },
    { value: newMiddle, removed: false, added: true, count: newMiddle.length },
  ];
  const changes =
    oldMiddle.length && newMiddle.length
      ? diffArrays(oldMiddle, newMiddle, { timeout: options.timeoutMs ?? 250 })
      : replaced;
  const approximate = changes === undefined;
  const parts = changes ?? replaced;

  const lines: DiffLine[] = [];
  let oldNo = 1;
  let newNo = 1;
  const same = (text: string) => lines.push(line('same', oldNo++, newNo++, text));
  before.slice(0, head).forEach(same);
  for (const part of parts) {
    for (const text of part.value) {
      if (part.removed) lines.push(line('del', oldNo++, null, text));
      else if (part.added) lines.push(line('add', null, newNo++, text));
      else same(text);
    }
  }
  before.slice(before.length - tail).forEach(same);

  highlightWords(lines);
  return {
    rows: fold(lines, context),
    added: lines.filter((l) => l.kind === 'add').length,
    removed: lines.filter((l) => l.kind === 'del').length,
    approximate,
  };
}

/// Pairs each block of removed lines with the added lines that follow it, row by row.
export function toSplitRows(rows: readonly DiffRow[]): SplitRow[] {
  const result: SplitRow[] = [];
  let removed: DiffLine[] = [];
  let added: DiffLine[] = [];
  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++)
      result.push({ kind: 'pair', left: removed[i] ?? null, right: added[i] ?? null });
    removed = [];
    added = [];
  };
  for (const row of rows) {
    if (row.kind === 'del') {
      if (added.length) flush();
      removed.push(row);
    } else if (row.kind === 'add') {
      added.push(row);
    } else {
      flush();
      result.push(row.kind === 'fold' ? row : { kind: 'pair', left: row, right: row });
    }
  }
  flush();
  return result;
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n');
}

function line(
  kind: DiffLineKind,
  oldNo: number | null,
  newNo: number | null,
  text: string,
): DiffLine {
  return { kind, oldNo, newNo, text, segments: null };
}

function highlightWords(lines: DiffLine[]): void {
  let pairs = 0;
  for (let i = 0; i < lines.length && pairs < WORD_DIFF_MAX_PAIRS;) {
    if (lines[i].kind !== 'del') {
      i++;
      continue;
    }
    const delStart = i;
    while (i < lines.length && lines[i].kind === 'del') i++;
    const addStart = i;
    while (i < lines.length && lines[i].kind === 'add') i++;
    const count = Math.min(addStart - delStart, i - addStart);
    for (let k = 0; k < count && pairs < WORD_DIFF_MAX_PAIRS; k++, pairs++)
      pairWords(lines[delStart + k], lines[addStart + k]);
  }
}

function pairWords(removed: DiffLine, added: DiffLine): void {
  if (removed.text.length > WORD_DIFF_MAX_LINE || added.text.length > WORD_DIFF_MAX_LINE) return;
  const parts = diffWordsWithSpace(removed.text, added.text);
  const changedChars = parts
    .filter((p) => p.added || p.removed)
    .reduce((sum, p) => sum + p.value.length, 0);
  const longest = Math.max(removed.text.length, added.text.length, 1);
  if (changedChars / (2 * longest) > WORD_DIFF_MAX_CHANGED_RATIO) return;
  removed.segments = parts
    .filter((p) => !p.added)
    .map((p) => ({ text: p.value, changed: !!p.removed }));
  added.segments = parts
    .filter((p) => !p.removed)
    .map((p) => ({ text: p.value, changed: !!p.added }));
}

function fold(lines: DiffLine[], context: number): DiffRow[] {
  const rows: DiffRow[] = [];
  let i = 0;
  while (i < lines.length) {
    if (lines[i].kind !== 'same') {
      rows.push(lines[i++]);
      continue;
    }
    const start = i;
    while (i < lines.length && lines[i].kind === 'same') i++;
    const keepBefore = start === 0 ? 0 : context;
    const keepAfter = i === lines.length ? 0 : context;
    const run = lines.slice(start, i);
    if (run.length <= keepBefore + keepAfter + 1) {
      rows.push(...run);
      continue;
    }
    rows.push(...run.slice(0, keepBefore));
    rows.push({ kind: 'fold', lines: run.slice(keepBefore, run.length - keepAfter) });
    rows.push(...run.slice(run.length - keepAfter));
  }
  return rows;
}
