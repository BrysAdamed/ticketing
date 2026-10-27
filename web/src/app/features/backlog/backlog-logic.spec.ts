import { BacklogItem } from '@core/tickets/ticket.models';
import {
  buildRows,
  EMPTY_FILTERS,
  matchesFilters,
  moveBlock,
  planDrop,
  sortItems,
  stickyGroupAt,
} from './backlog-logic';
import { EMPTY_SELECTION, prune, select, step, targets } from './backlog-selection';

function item(n: number, overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: `id-${n}`,
    key: `WEB-${n}`,
    title: `Ticket ${n}`,
    type: 'UserStory',
    status: 'ToDo',
    priority: 'Medium',
    severity: null,
    storyPoints: null,
    version: null,
    labels: [],
    assigneeId: null,
    parentId: null,
    updatedAt: `2026-10-${String(10 + n).padStart(2, '0')}T00:00:00Z`,
    childCount: 0,
    childDoneCount: 0,
    commentCount: 0,
    testCaseCount: 0,
    ...overrides,
  };
}

const context = {
  users: new Map(),
  parents: new Map(),
  collapsed: new Set<string>(),
  showEmpty: false,
};

describe('moveBlock', () => {
  const items = [1, 2, 3, 4, 5].map((n) => item(n));
  const keys = (list: BacklogItem[]) => list.map((i) => i.key);

  it('moves a block before an anchor in the given order', () => {
    // Act
    const result = moveBlock(items, ['id-5', 'id-3'], { beforeId: 'id-2' });

    // Assert
    expect(keys(result)).toEqual(['WEB-1', 'WEB-5', 'WEB-3', 'WEB-2', 'WEB-4']);
  });

  it('moves after an anchor and to the top or bottom', () => {
    // Act / Assert
    expect(keys(moveBlock(items, ['id-1'], { afterId: 'id-3' }))).toEqual([
      'WEB-2',
      'WEB-3',
      'WEB-1',
      'WEB-4',
      'WEB-5',
    ]);
    expect(keys(moveBlock(items, ['id-4'], { position: 'Top' }))).toEqual([
      'WEB-4',
      'WEB-1',
      'WEB-2',
      'WEB-3',
      'WEB-5',
    ]);
    expect(keys(moveBlock(items, ['id-1', 'id-2'], { position: 'Bottom' }))).toEqual([
      'WEB-3',
      'WEB-4',
      'WEB-5',
      'WEB-1',
      'WEB-2',
    ]);
  });
});

describe('buildRows', () => {
  it('groups by status in category order and skips empty groups', () => {
    // Arrange
    const items = [
      item(1),
      item(2, { status: 'Review', storyPoints: 3 }),
      item(3, { status: 'InProgress', storyPoints: 5 }),
    ];

    // Act
    const rows = buildRows(items, 'status', context);

    // Assert
    expect(
      rows.map((r) => (r.kind === 'group' ? `[${r.label} ${r.count}/${r.points}]` : r.item.key)),
    ).toEqual(['[In Progress 1/5]', 'WEB-3', '[Review 1/3]', 'WEB-2', '[To Do 1/0]', 'WEB-1']);
  });

  it('hides tickets of collapsed groups but keeps the header', () => {
    // Act
    const rows = buildRows([item(1), item(2)], 'status', {
      ...context,
      collapsed: new Set(['status:ToDo']),
    });

    // Assert
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'group', count: 2, collapsed: true });
  });

  it('puts unassigned tickets last when grouping by assignee', () => {
    // Arrange
    const users = new Map([
      ['u1', { id: 'u1', email: 'a@x', displayName: 'Anna', isActive: true }],
    ]);

    // Act
    const rows = buildRows([item(1), item(2, { assigneeId: 'u1' })], 'assignee', {
      ...context,
      users,
    });

    // Assert
    expect(
      rows.filter((r) => r.kind === 'group').map((r) => r.kind === 'group' && r.label),
    ).toEqual(['Anna', 'Unassigned']);
  });
});

describe('planDrop', () => {
  it('anchors before the next ticket of the group, or after the previous one at the end', () => {
    // Arrange
    const rows = buildRows([item(1), item(2), item(3)], 'status', context);

    // Act
    const middle = planDrop(rows, new Set(['id-3']), 2, 'status:ToDo');
    const end = planDrop(rows, new Set(['id-1']), rows.length, 'status:ToDo');

    // Assert
    expect(middle?.anchor).toEqual({ beforeKey: 'WEB-2' });
    expect(end?.anchor).toEqual({ afterKey: 'WEB-3' });
  });
});

describe('matchesFilters', () => {
  it('hides done tickets unless show done is on', () => {
    // Arrange
    const done = item(1, { status: 'Done' });

    // Act / Assert
    expect(matchesFilters(done, EMPTY_FILTERS, null)).toBe(false);
    expect(matchesFilters(done, { ...EMPTY_FILTERS, showDone: true }, null)).toBe(true);
  });

  it('matches title text or the key number, assignee me and labels', () => {
    // Arrange
    const ticket = item(12, { assigneeId: 'me-id', labels: ['ui', 'auth'] });

    // Act / Assert
    expect(matchesFilters(ticket, { ...EMPTY_FILTERS, text: 'web-12' }, null)).toBe(true);
    expect(matchesFilters(ticket, { ...EMPTY_FILTERS, text: 'ticket 12' }, null)).toBe(true);
    expect(matchesFilters(ticket, { ...EMPTY_FILTERS, text: 'nope' }, null)).toBe(false);
    expect(matchesFilters(ticket, { ...EMPTY_FILTERS, assignee: 'me' }, 'me-id')).toBe(true);
    expect(matchesFilters(ticket, { ...EMPTY_FILTERS, assignee: 'unassigned' }, 'me-id')).toBe(
      false,
    );
    expect(matchesFilters(ticket, { ...EMPTY_FILTERS, labels: ['UI'] }, null)).toBe(true);
  });
});

describe('sortItems', () => {
  it('sorts by priority keeping rank order for ties', () => {
    // Arrange
    const items = [
      item(1, { priority: 'Low' }),
      item(2, { priority: 'Highest' }),
      item(3, { priority: 'Low' }),
    ];

    // Act / Assert
    expect(sortItems(items, 'priority').map((i) => i.key)).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);
    expect(sortItems(items, 'created').map((i) => i.key)).toEqual(['WEB-3', 'WEB-2', 'WEB-1']);
  });
});

describe('selection', () => {
  const order = ['a', 'b', 'c', 'd'];

  it('selects single, toggles and extends ranges from the anchor', () => {
    // Act
    const one = select(EMPTY_SELECTION, order, 'b', 'single');
    const toggled = select(one, order, 'd', 'toggle');
    const range = select(one, order, 'd', 'range');

    // Assert
    expect([...one.selected]).toEqual(['b']);
    expect([...toggled.selected].sort()).toEqual(['b', 'd']);
    expect([...range.selected].sort()).toEqual(['b', 'c', 'd']);
  });

  it('acts on the focused row when it is not part of the selection', () => {
    // Arrange
    const state = select(EMPTY_SELECTION, order, 'a', 'single');

    // Act / Assert
    expect(targets(select(state, order, 'c', 'toggle'), order, 'c')).toEqual(['a', 'c']);
    expect(targets(state, order, 'd')).toEqual(['d']);
  });

  it('prunes hidden ids and steps through the list', () => {
    // Act / Assert
    expect([...prune(select(EMPTY_SELECTION, order, 'c', 'single'), ['a', 'b']).selected]).toEqual(
      [],
    );
    expect(step(order, null, 1)).toBe('a');
    expect(step(order, 'd', 1)).toBe('d');
    expect(step(order, 'b', -1)).toBe('a');
  });
});

describe('stickyGroupAt', () => {
  const group = (id: string) => ({ kind: 'group', id }) as const;
  const ticket = { kind: 'ticket' } as const;
  const rows = [group('a'), ticket, ticket, ticket, group('b'), ticket, ticket];

  it('pins the group of the first visible row and lets the next header push it out', () => {
    // Act
    const atTop = stickyGroupAt(rows, 0, 32);
    const inA = stickyGroupAt(rows, 40, 32);
    const pushed = stickyGroupAt(rows, 3 * 32 + 10, 32);
    const inB = stickyGroupAt(rows, 5 * 32, 32);

    // Assert
    expect(atTop).toBeNull();
    expect(inA).toEqual({ group: group('a'), offset: 0 });
    expect(pushed).toEqual({ group: group('a'), offset: -10 });
    expect(inB).toEqual({ group: group('b'), offset: 0 });
  });

  it('returns null for an ungrouped list', () => {
    // Act / Assert
    expect(stickyGroupAt([ticket, ticket, ticket], 50, 32)).toBeNull();
  });
});
