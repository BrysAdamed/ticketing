import { describe, expect, it } from 'vitest';
import {
  EMPTY_DOC_SEARCH,
  effectiveDocSort,
  hasDocFilters,
  parseDocSearchParams,
  sameDocFilters,
  scopeOf,
  toDocApiParams,
  toDocSearchParams,
} from './doc-search-query';

describe('doc search query', () => {
  it('reads the docs filters from the URL and writes them back canonically', () => {
    // Arrange
    const params = {
      scope: 'docs',
      project: ['pay', 'web,PAY'],
      kind: 'Page,Diagram',
      q: ' idempotency ',
      folder: 'PAY-D-3',
      mentions: 'PAY-42',
      updatedFrom: '2026-10-01',
      sort: 'Updated',
      peek: 'PAY-1',
    };

    // Act
    const filters = parseDocSearchParams(params);

    // Assert
    expect(filters).toEqual({
      project: ['PAY', 'WEB'],
      q: 'idempotency',
      kind: ['Page', 'Diagram'],
      folder: 'PAY-D-3',
      mentions: 'PAY-42',
      updatedFrom: '2026-10-01',
      updatedTo: '',
      sort: 'updated',
    });
    expect(toDocSearchParams(filters)).toEqual({
      scope: 'docs',
      project: 'PAY,WEB',
      kind: 'Page,Diagram',
      q: 'idempotency',
      folder: 'PAY-D-3',
      mentions: 'PAY-42',
      updatedFrom: '2026-10-01',
      sort: 'updated',
    });
    expect(toDocApiParams(filters)).not.toHaveProperty('scope');
  });

  it('defaults to the tickets scope and drops unknown sorts', () => {
    // Act + Assert
    expect(scopeOf({})).toBe('tickets');
    expect(scopeOf({ scope: 'DOCS' })).toBe('docs');
    expect(scopeOf({ scope: 'other' })).toBe('tickets');
    expect(parseDocSearchParams({ sort: 'rank' }).sort).toBe('');
  });

  it('sorts by relevance only when there is text', () => {
    // Act + Assert
    expect(effectiveDocSort(EMPTY_DOC_SEARCH)).toBe('updated');
    expect(effectiveDocSort({ ...EMPTY_DOC_SEARCH, sort: 'relevance' })).toBe('updated');
    expect(effectiveDocSort({ ...EMPTY_DOC_SEARCH, q: 'x' })).toBe('relevance');
    expect(effectiveDocSort({ ...EMPTY_DOC_SEARCH, q: 'x', sort: 'updated' })).toBe('updated');
  });

  it('compares filters by their canonical form and ignores the sort for "has filters"', () => {
    // Act + Assert
    expect(hasDocFilters({ ...EMPTY_DOC_SEARCH, sort: 'updated' })).toBe(false);
    expect(hasDocFilters({ ...EMPTY_DOC_SEARCH, kind: ['Page'] })).toBe(true);
    expect(sameDocFilters({ ...EMPTY_DOC_SEARCH, q: 'a ' }, { ...EMPTY_DOC_SEARCH, q: 'a' })).toBe(
      true,
    );
  });
});
