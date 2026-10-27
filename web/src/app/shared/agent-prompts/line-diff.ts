export type DiffRowKind = 'same' | 'changed' | 'removed' | 'added';

export interface DiffCell {
  number: number;
  text: string;
}

/// One row of a side-by-side diff: the left (old) and right (new) line, either of which may be
/// missing for a pure removal or addition.
export interface DiffRow {
  kind: DiffRowKind;
  left: DiffCell | null;
  right: DiffCell | null;
}

/// Side-by-side line diff (longest common subsequence). Runs of removed and added lines next to each
/// other are paired into `changed` rows, so an edited line sits next to its new version.
export function lineDiff(left: string, right: string): DiffRow[] {
  const a = splitLines(left);
  const b = splitLines(right);
  const lcs = lcsTable(a, b);
  const rows: DiffRow[] = [];
  let removed: DiffCell[] = [];
  let added: DiffCell[] = [];
  const flush = () => {
    const paired = Math.min(removed.length, added.length);
    for (let k = 0; k < paired; k++)
      rows.push({ kind: 'changed', left: removed[k], right: added[k] });
    for (const cell of removed.slice(paired))
      rows.push({ kind: 'removed', left: cell, right: null });
    for (const cell of added.slice(paired)) rows.push({ kind: 'added', left: null, right: cell });
    removed = [];
    added = [];
  };

  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      flush();
      rows.push({
        kind: 'same',
        left: { number: i + 1, text: a[i] },
        right: { number: j + 1, text: b[j] },
      });
      i++;
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) {
      added.push({ number: j + 1, text: b[j] });
      j++;
    } else {
      removed.push({ number: i + 1, text: a[i] });
      i++;
    }
  }
  flush();
  return rows;
}

/// Counts of changed lines, for a summary such as "3 lines changed".
export function diffStats(rows: readonly DiffRow[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const row of rows) {
    if (row.kind === 'added' || row.kind === 'changed') added++;
    if (row.kind === 'removed' || row.kind === 'changed') removed++;
  }
  return { added, removed };
}

function splitLines(text: string): string[] {
  return text === '' ? [] : text.replace(/\r\n?/g, '\n').split('\n');
}

function lcsTable(a: readonly string[], b: readonly string[]): number[][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      table[i][j] =
        a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  return table;
}
