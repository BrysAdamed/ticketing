import { describe, expect, it } from 'vitest';
import {
  EMPTY_SEARCH,
  effectiveOrder,
  hasFilters,
  parseSearchParams,
  searchQueryString,
  toggleValue,
  toSearchParams,
  utcDate,
} from './search-query';

describe('search URL format', () => {
  it('merges comma-separated and repeated values and normalizes case', () => {
    // Arrange
    const params = {
      project: ['web,api', 'WEB'],
      status: 'InProgress,Review',
      label: 'UI, Backend',
      q: ' login ',
    };

    // Act
    const filters = parseSearchParams(params);

    // Assert
    expect(filters.project).toEqual(['WEB', 'API']);
    expect(filters.status).toEqual(['InProgress', 'Review']);
    expect(filters.label).toEqual(['ui', 'backend']);
    expect(filters.q).toBe('login');
  });

  it('round-trips through the canonical params', () => {
    // Arrange
    const filters = {
      ...EMPTY_SEARCH,
      project: ['WEB'],
      category: ['ToDo', 'InProgress'],
      assignee: ['me'],
      severity: ['none'],
      version: '1.4.0',
      fromRegression: true,
      sort: 'priority' as const,
      order: 'desc' as const,
    };

    // Act
    const query = searchQueryString(filters);
    const parsed = parseSearchParams(Object.fromEntries(new URLSearchParams(query)));

    // Assert
    expect(query).toBe(
      'project=WEB&category=ToDo%2CInProgress&severity=none&assignee=me&version=1.4.0&fromRegression=true&sort=priority&order=desc',
    );
    expect(parsed).toEqual(filters);
  });

  it('omits defaults and empty values', () => {
    // Act
    const params = toSearchParams({ ...EMPTY_SEARCH, q: '  ', sort: 'updated' });

    // Assert
    expect(params).toEqual({});
    expect(hasFilters({ ...EMPTY_SEARCH, sort: 'key' })).toBe(false);
    expect(hasFilters({ ...EMPTY_SEARCH, label: ['x'] })).toBe(true);
  });

  it('falls back to the default sort for unknown values', () => {
    // Act
    const filters = parseSearchParams({ sort: 'title', order: 'up' });

    // Assert
    expect(filters.sort).toBe('updated');
    expect(filters.order).toBe('');
    expect(effectiveOrder(filters)).toBe('desc');
    expect(effectiveOrder({ sort: 'key', order: '' })).toBe('asc');
  });

  it('toggles list values', () => {
    // Act
    const added = toggleValue(EMPTY_SEARCH, 'type', 'Bug');
    const removed = toggleValue(added, 'type', 'Bug');

    // Assert
    expect(added.type).toEqual(['Bug']);
    expect(removed.type).toEqual([]);
  });

  it('formats UTC dates for relative presets', () => {
    // Act
    const date = utcDate(new Date('2026-10-27T01:30:00+02:00'), 7);

    // Assert
    expect(date).toBe('2026-10-19');
  });
});
