import { TestCaseSummary } from '@core/testing/testing.models';
import { adjustCounts, EMPTY_FILTERS, filtersFromQuery, filtersToQuery, matches, upsertRow } from './test-case-list-logic';

function row(number: number, overrides: Partial<TestCaseSummary> = {}): TestCaseSummary {
  return {
    id: `id-${number}`,
    key: `WEB-TC-${number}`,
    number,
    title: `Case ${number}`,
    status: 'Manual',
    stepCount: 1,
    ticket: null,
    archived: false,
    updatedAt: '2026-10-01T00:00:00Z',
    lastRun: null,
    ...overrides,
  };
}

describe('test case list logic', () => {
  it('round-trips filters through the URL query', () => {
    // Arrange
    const filters = { status: 'Automatic' as const, text: ' login ', ticket: 'WEB-4', archived: true };

    // Act
    const query = filtersToQuery(filters);
    const parsed = filtersFromQuery({ ...query, ticket: 'web-4' });

    // Assert
    expect(query).toEqual({ status: 'Automatic', q: 'login', ticket: 'WEB-4', archived: 'true' });
    expect(parsed).toEqual({ status: 'Automatic', text: 'login', ticket: 'WEB-4', archived: true });
    expect(filtersFromQuery({ status: 'Bogus' }).status).toBe('All');
  });

  it('keeps rows in number order and drops rows that no longer match', () => {
    // Arrange
    const rows = [row(1), row(3)];
    const filters = { ...EMPTY_FILTERS, status: 'Manual' as const };

    // Act
    const inserted = upsertRow(rows, row(2), filters);
    const changed = upsertRow(inserted, row(3, { status: 'New' }), filters);

    // Assert
    expect(inserted.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(changed.map((r) => r.number)).toEqual([1, 2]);
  });

  it('matches text on title, key or number and hides archived rows unless asked', () => {
    // Arrange
    const archived = row(7, { archived: true, title: 'Export' });

    // Act / Assert
    expect(matches(row(7), { ...EMPTY_FILTERS, text: 'tc-7' })).toBe(true);
    expect(matches(row(7), { ...EMPTY_FILTERS, text: '7' })).toBe(true);
    expect(matches(archived, { ...EMPTY_FILTERS, text: 'exp' })).toBe(false);
    expect(matches(archived, { ...EMPTY_FILTERS, text: 'exp', archived: true })).toBe(true);
  });

  it('moves a case between count buckets', () => {
    // Arrange
    const counts = { new: 1, manual: 2, automatic: 0, archived: 0, active: 3 };

    // Act
    const archivedOne = adjustCounts(counts, row(1), row(1, { archived: true }));
    const created = adjustCounts(counts, null, row(9, { status: 'Automatic' }));

    // Assert
    expect(archivedOne).toEqual({ new: 1, manual: 1, automatic: 0, archived: 1, active: 2 });
    expect(created).toEqual({ new: 1, manual: 2, automatic: 1, archived: 0, active: 4 });
  });
});
