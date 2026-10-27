import { RegressionItem } from '@core/testing/testing.models';
import { buildRows, filterCounts, matchesFilter, nextWaiting, orderedItems, passRateLabel, progressSegments } from './session-logic';

const me = { id: 'me', email: 'me@x', displayName: 'Me', isActive: true };
const other = { id: 'other', email: 'o@x', displayName: 'Other', isActive: true };

function item(order: number, overrides: Partial<RegressionItem> = {}): RegressionItem {
  return {
    id: `i${order}`,
    testCaseId: `tc${order}`,
    testCaseKey: `WEB-TC-${order}`,
    order,
    title: `Case ${order}`,
    preconditions: null,
    steps: ['Step'],
    expectedResult: null,
    automationReference: null,
    executionMode: 'Manual',
    status: 'WaitingForExecution',
    autoPassed: false,
    assignee: null,
    resultNote: null,
    executedAt: null,
    executedBy: null,
    bug: null,
    url: '',
    rowVersion: 1,
    ...overrides,
  };
}

describe('regression session logic', () => {
  it('groups waiting first, then failed, passed and skipped, each in snapshot order', () => {
    // Arrange
    const items = [item(3, { status: 'Passed' }), item(2), item(1, { status: 'Failed' }), item(4)];

    // Act
    const rows = buildRows(items);

    // Assert
    expect(rows.map((r) => (r.kind === 'group' ? r.label : r.item.testCaseKey))).toEqual([
      'Waiting for execution',
      'WEB-TC-2',
      'WEB-TC-4',
      'Failed',
      'WEB-TC-1',
      'Passed',
      'WEB-TC-3',
    ]);
    expect(orderedItems(rows).map((i) => i.order)).toEqual([2, 4, 1, 3]);
  });

  it('filters mine, waiting, failed and text', () => {
    // Arrange
    const items = [item(1, { assignee: me }), item(2, { status: 'Failed', assignee: other }), item(3, { title: 'Export' })];

    // Act
    const counts = filterCounts(items, 'me');

    // Assert
    expect(counts).toEqual({ mine: 1, waiting: 2, failed: 1, all: 3 });
    expect(items.filter((i) => matchesFilter(i, 'all', 'me', 'expo')).map((i) => i.order)).toEqual([3]);
    expect(items.filter((i) => matchesFilter(i, 'mine', null)).length).toBe(0);
  });

  it('finds the next waiting item, preferring mine and unassigned ones, wrapping around', () => {
    // Arrange
    const items = [item(1), item(2, { assignee: other }), item(3, { status: 'Passed' }), item(4, { assignee: me })];

    // Act
    const afterOne = nextWaiting(items, 'WEB-TC-1', 'me');
    const afterFour = nextWaiting(items, 'WEB-TC-4', 'me');
    const none = nextWaiting([item(1, { status: 'Passed' })], null, 'me');

    // Assert
    expect(afterOne?.testCaseKey).toBe('WEB-TC-4');
    expect(afterFour?.testCaseKey).toBe('WEB-TC-1');
    expect(none).toBeNull();
  });

  it('computes progress segments and the pass rate label', () => {
    // Arrange
    const summary = { total: 4, passed: 2, passedManual: 1, passedAutomatic: 1, failed: 1, skipped: 0, waiting: 1, passRate: 2 / 3, bugsCreated: 0 };

    // Act
    const segments = progressSegments(summary);

    // Assert
    expect(segments.map((s) => s.percent)).toEqual([50, 25, 0, 25]);
    expect(passRateLabel(summary)).toBe('67%');
    expect(passRateLabel({ ...summary, passRate: null })).toBe('–');
  });
});
