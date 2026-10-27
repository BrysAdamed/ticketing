import { describe, expect, it } from 'vitest';
import { highlightSegments, queryRanges } from './highlight';

describe('highlightSegments', () => {
  it('splits text into plain and marked parts', () => {
    // Act
    const segments = highlightSegments('the idempotency key', [{ start: 4, length: 11 }]);

    // Assert
    expect(segments).toEqual([
      { text: 'the ', mark: false },
      { text: 'idempotency', mark: true },
      { text: ' key', mark: false },
    ]);
  });

  it('clamps, sorts and merges ranges from any input', () => {
    // Act
    const segments = highlightSegments('abcdef', [
      { start: 4, length: 10 },
      { start: -2, length: 3 },
      { start: 1, length: 1 },
      { start: 3, length: 0 },
    ]);

    // Assert
    expect(segments).toEqual([
      { text: 'ab', mark: true },
      { text: 'cd', mark: false },
      { text: 'ef', mark: true },
    ]);
  });

  it('keeps markup as plain text', () => {
    // Act
    const segments = highlightSegments('<img src=x onerror=alert(1)>', [{ start: 1, length: 3 }]);

    // Assert
    expect(segments.map((s) => s.text).join('')).toBe('<img src=x onerror=alert(1)>');
  });

  it('returns the whole text when nothing matches', () => {
    // Act + Assert
    expect(highlightSegments('plain', [])).toEqual([{ text: 'plain', mark: false }]);
    expect(highlightSegments('', [])).toEqual([{ text: '', mark: false }]);
  });
});

describe('queryRanges', () => {
  it('finds every query word case-insensitively and ignores one-letter words', () => {
    // Act
    const ranges = queryRanges('Payment flow and payment retries', 'PAYMENT a "flow"');

    // Assert
    expect(ranges).toEqual([
      { start: 0, length: 7 },
      { start: 17, length: 7 },
      { start: 8, length: 4 },
    ]);
  });
});
