import { describe, expect, it } from 'vitest';
import { DiffFold, DiffLine, DiffRow, diffDocs, toSplitRows } from './doc-diff';

function render(rows: readonly DiffRow[]): string[] {
  return rows.map((row) =>
    row.kind === 'fold'
      ? `~${row.lines.length}`
      : `${{ same: ' ', add: '+', del: '-' }[row.kind]}${row.text}`,
  );
}

function numbered(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n');
}

describe('diffDocs', () => {
  it('shows added and removed lines with line numbers of both sides', () => {
    // Arrange
    const before = 'a\nb\nc';
    const after = 'a\nB\nc\nd';

    // Act
    const diff = diffDocs(before, after);

    // Assert
    expect(render(diff.rows)).toEqual([' a', '-b', '+B', ' c', '+d']);
    expect([diff.added, diff.removed, diff.approximate]).toEqual([2, 1, false]);
    const lines = diff.rows as DiffLine[];
    expect(lines.map((l) => [l.oldNo, l.newNo])).toEqual([
      [1, 1],
      [2, null],
      [null, 2],
      [3, 3],
      [null, 4],
    ]);
  });

  it('folds long unchanged runs and keeps context around changes', () => {
    // Arrange
    const before = numbered(30);
    const after = before.replace('line 15', 'line fifteen');

    // Act
    const diff = diffDocs(before, after, { context: 2 });

    // Assert
    expect(render(diff.rows)).toEqual([
      '~12',
      ' line 13',
      ' line 14',
      '-line 15',
      '+line fifteen',
      ' line 16',
      ' line 17',
      '~13',
    ]);
    expect((diff.rows[0] as DiffFold).lines[0].text).toBe('line 1');
  });

  it('keeps short unchanged runs between changes', () => {
    // Act
    const diff = diffDocs('a\nx\ny\nz\nb', 'A\nx\ny\nz\nB', { context: 1 });

    // Assert
    expect(render(diff.rows)).toEqual(['-a', '+A', ' x', ' y', ' z', '-b', '+B']);
  });

  it('highlights the changed words of paired lines', () => {
    // Act
    const diff = diffDocs('API->>Stripe: create charge', 'API->>Stripe: create PaymentIntent');

    // Assert
    const [removed, added] = diff.rows as DiffLine[];
    expect(removed.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(['charge']);
    expect(added.segments?.filter((s) => s.changed).map((s) => s.text)).toEqual(['PaymentIntent']);
    expect(added.segments?.map((s) => s.text).join('')).toBe(added.text);
  });

  it('shows a completely rewritten line without word highlights', () => {
    // Act
    const diff = diffDocs('one two three', 'completely different text');

    // Assert
    expect((diff.rows as DiffLine[]).map((l) => l.segments)).toEqual([null, null]);
  });

  it('handles empty versions, identical versions and windows line endings', () => {
    // Act
    const created = diffDocs('', 'a\nb');
    const cleared = diffDocs('a\nb', '');
    const identical = diffDocs('a\r\nb', 'a\nb');

    // Assert
    expect(render(created.rows)).toEqual(['+a', '+b']);
    expect(render(cleared.rows)).toEqual(['-a', '-b']);
    expect([identical.added, identical.removed]).toEqual([0, 0]);
    expect(render(identical.rows)).toEqual(['~2']);
  });

  it('falls back to remove and add of the changed region when the line diff times out', () => {
    // Act
    const diff = diffDocs(numbered(400, 'old'), numbered(400, 'new'), { timeoutMs: 0 });

    // Assert
    expect(diff.approximate).toBe(true);
    expect([diff.removed, diff.added]).toEqual([400, 400]);
  });

  it('diffs two 100 KB versions in under 300 ms', () => {
    // Arrange
    const before = Array.from(
      { length: 2_500 },
      (_, i) => `Paragraph ${i} of the design document with some words ${i * 7}.`,
    ).join('\n');
    const lines = before.split('\n');
    for (let i = 0; i < lines.length; i += 25) lines[i] = `${lines[i]} edited`;
    for (let i = 10; i < lines.length; i += 97) lines.splice(i, 0, `Inserted line ${i}`);
    const after = lines.join('\n');
    expect(before.length).toBeGreaterThan(100_000);

    // Act
    const start = performance.now();
    const diff = diffDocs(before, after);
    const elapsed = performance.now() - start;

    // Assert
    expect(diff.approximate).toBe(false);
    expect(diff.removed).toBe(100);
    expect(elapsed).toBeLessThan(300);
  });
});

describe('toSplitRows', () => {
  it('pairs removed and added lines side by side and keeps folds', () => {
    // Arrange
    const diff = diffDocs(
      `${numbered(10)}\nold a\nold b\nend`,
      `${numbered(10)}\nnew a\nend\nextra`,
      {
        context: 1,
      },
    );

    // Act
    const rows = toSplitRows(diff.rows);

    // Assert
    expect(
      rows.map((row) =>
        row.kind === 'fold'
          ? `~${row.lines.length}`
          : `${row.left?.text ?? '_'}|${row.right?.text ?? '_'}`,
      ),
    ).toEqual(['~9', 'line 10|line 10', 'old a|new a', 'old b|_', 'end|end', '_|extra']);
  });
});
