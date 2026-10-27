import { lineDiff } from './line-diff';
import {
  highlightIssues,
  insertPlaceholder,
  matchPlaceholders,
  placeholderQuery,
} from './template-text';

const PLACEHOLDERS = [
  { name: 'ticket.key', description: '' },
  { name: 'ticket.url', description: '' },
  { name: 'project.key', description: '' },
];

describe('placeholder completion', () => {
  it('finds the placeholder being typed before the caret', () => {
    // Act & Assert
    expect(placeholderQuery('Fix {{tick', 10)).toEqual({ start: 4, query: 'tick' });
    expect(placeholderQuery('Fix {{ ', 7)).toEqual({ start: 4, query: '' });
    expect(placeholderQuery('Fix {{ticket.key}} now', 22)).toBeNull();
    expect(placeholderQuery('{{a\nb', 5)).toBeNull();
  });

  it('ranks prefix matches before other matches', () => {
    // Act
    const names = matchPlaceholders(PLACEHOLDERS, 'key').map((p) => p.name);
    const prefixed = matchPlaceholders(PLACEHOLDERS, 'p').map((p) => p.name);

    // Assert
    expect(names).toEqual(['ticket.key', 'project.key']);
    expect(prefixed[0]).toBe('project.key');
  });

  it('inserts the placeholder and reuses closing braces after the caret', () => {
    // Act
    const typed = insertPlaceholder('Fix {{tic now', 4, 9, 'ticket.key');
    const closed = insertPlaceholder('Fix {{tic}} now', 4, 9, 'ticket.key');

    // Assert
    expect(typed).toEqual({ text: 'Fix {{ticket.key}} now', caret: 18 });
    expect(closed).toEqual({ text: 'Fix {{ticket.key}} now', caret: 18 });
  });
});

describe('highlightIssues', () => {
  it('marks the whole placeholder an error points at, on its line', () => {
    // Act
    const lines = highlightIssues('ok\n  {{ticket.description}} x', [
      { code: 'agent.template.unknownPlaceholder', message: 'Unknown', line: 2, column: 3 },
    ]);

    // Assert
    expect(lines[0]).toEqual([{ text: 'ok', issue: null }]);
    expect(lines[1].map((s) => [s.text, !!s.issue])).toEqual([
      ['  ', false],
      ['{{ticket.description}}', true],
      [' x', false],
    ]);
  });

  it('keeps an error at the end of a line visible', () => {
    // Act
    const [line] = highlightIssues('{{#if x}}', [
      { code: 'agent.template.unbalancedIf', message: 'Unclosed', line: 1, column: 10 },
    ]);

    // Assert
    expect(line.at(-1)).toEqual(expect.objectContaining({ text: ' ' }));
  });
});

describe('lineDiff', () => {
  it('pairs edited lines and keeps unchanged ones aligned', () => {
    // Act
    const rows = lineDiff('a\nb\nc', 'a\nB\nc\nd');

    // Assert
    expect(rows.map((r) => r.kind)).toEqual(['same', 'changed', 'same', 'added']);
    expect(rows[1]).toEqual({
      kind: 'changed',
      left: { number: 2, text: 'b' },
      right: { number: 2, text: 'B' },
    });
  });

  it('reports removed lines and identical texts', () => {
    // Act & Assert
    expect(lineDiff('a\nb', 'a').map((r) => r.kind)).toEqual(['same', 'removed']);
    expect(lineDiff('x', 'x').every((r) => r.kind === 'same')).toBe(true);
    expect(lineDiff('', 'x').map((r) => r.kind)).toEqual(['added']);
  });
});
