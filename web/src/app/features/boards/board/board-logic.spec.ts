import { Board, BoardCard, BoardColumn, BoardParent } from '@core/boards/board.models';
import { TICKET_STATUSES, TicketStatus, statusCategory } from '@shared/domain/enums';
import {
  anchorFor,
  applyMove,
  buildLanes,
  cardMatches,
  EMPTY_FILTERS,
  epicOf,
  filtersFromParams,
  filtersToParams,
  inBoardOrder,
  parseSwimlanes,
} from './board-logic';

function card(n: number, overrides: Partial<BoardCard> = {}): BoardCard {
  return {
    id: `id-${n}`,
    key: `WEB-${n}`,
    projectKey: 'WEB',
    title: `Ticket ${n}`,
    type: 'UserStory',
    priority: 'Medium',
    severity: null,
    storyPoints: null,
    labels: [],
    assigneeId: null,
    parentId: null,
    childCount: 0,
    childDoneCount: 0,
    ...overrides,
  };
}

function columns(layout: Partial<Record<TicketStatus, BoardCard[]>>): BoardColumn[] {
  return TICKET_STATUSES.map((status) => ({
    status,
    category: statusCategory(status),
    cards: layout[status] ?? [],
  }));
}

function board(cols: BoardColumn[], parents: BoardParent[] = []): Board {
  return {
    id: 'b',
    name: 'Sprint',
    description: null,
    owner: { id: 'u1', email: 'a@x', displayName: 'Ann', isActive: true },
    archivedAt: null,
    createdAt: '2026-10-01T00:00:00Z',
    permissions: { canManage: true },
    projects: [],
    columns: cols,
    users: [
      { id: 'u1', email: 'a@x', displayName: 'Ann', isActive: true },
      { id: 'u2', email: 'b@x', displayName: 'Bob', isActive: true },
    ],
    parents,
    rowVersion: 1,
  };
}

const keys = (cards: readonly BoardCard[]) => cards.map((c) => c.key);

describe('applyMove', () => {
  it('moves a block into another column before the anchor, in the given order', () => {
    // Arrange
    const cols = columns({ ToDo: [card(1), card(2), card(3)], Review: [card(4), card(5)] });

    // Act
    const result = applyMove(cols, ['id-3', 'id-1'], 'Review', { beforeId: 'id-5' });

    // Assert
    expect(keys(result[0].cards)).toEqual(['WEB-2']);
    expect(keys(result[3].cards)).toEqual(['WEB-4', 'WEB-3', 'WEB-1', 'WEB-5']);
    expect(result[1]).toBe(cols[1]);
  });

  it('reorders within a column after an anchor and appends without one', () => {
    // Arrange
    const cols = columns({ ToDo: [card(1), card(2), card(3)] });

    // Act
    const after = applyMove(cols, ['id-1'], 'ToDo', { afterId: 'id-2' });
    const bottom = applyMove(cols, ['id-1'], 'Done', {});

    // Assert
    expect(keys(after[0].cards)).toEqual(['WEB-2', 'WEB-1', 'WEB-3']);
    expect(keys(bottom[7].cards)).toEqual(['WEB-1']);
  });
});

describe('anchorFor', () => {
  const cell = [card(1), card(2), card(3), card(4)];

  it('uses the card now at the drop index as the before anchor', () => {
    // Act / Assert
    expect(anchorFor(cell, 'id-1', 2, new Set(['id-1']))).toEqual({ beforeId: 'id-4' });
    expect(anchorFor(cell, 'id-9', 0, new Set(['id-9']))).toEqual({ beforeId: 'id-1' });
  });

  it('falls back to the previous card at the end and to nothing in an empty cell', () => {
    // Act / Assert
    expect(anchorFor(cell, 'id-9', 4, new Set(['id-9']))).toEqual({ afterId: 'id-4' });
    expect(anchorFor([], 'id-9', 0, new Set(['id-9']))).toEqual({});
  });

  it('skips other moving cards as neighbours', () => {
    // Act / Assert
    expect(anchorFor(cell, 'id-9', 1, new Set(['id-9', 'id-2', 'id-3']))).toEqual({
      beforeId: 'id-4',
    });
    expect(anchorFor(cell, 'id-9', 4, new Set(['id-9', 'id-4']))).toEqual({ afterId: 'id-3' });
  });
});

describe('filters', () => {
  it('matches mine, assignees incl. unassigned, types, labels, projects and text', () => {
    // Arrange
    const mine = card(1, { assigneeId: 'u1', labels: ['ui'], type: 'Bug' });
    const nobody = card(2, { projectKey: 'API', title: 'Login flow' });

    // Act / Assert
    expect(cardMatches(mine, { ...EMPTY_FILTERS, mine: true }, 'u1')).toBe(true);
    expect(cardMatches(nobody, { ...EMPTY_FILTERS, mine: true }, 'u1')).toBe(false);
    expect(cardMatches(nobody, { ...EMPTY_FILTERS, assignees: ['unassigned'] }, 'u1')).toBe(true);
    expect(
      cardMatches(mine, { ...EMPTY_FILTERS, types: ['Bug'], labels: ['ui', 'api'] }, null),
    ).toBe(true);
    expect(cardMatches(mine, { ...EMPTY_FILTERS, projects: ['API'] }, null)).toBe(false);
    expect(cardMatches(nobody, { ...EMPTY_FILTERS, text: 'login' }, null)).toBe(true);
    expect(cardMatches(nobody, { ...EMPTY_FILTERS, text: 'web-2' }, null)).toBe(true);
  });

  it('round-trips through URL params', () => {
    // Arrange
    const filters = {
      assignees: ['u1', 'unassigned'],
      types: ['Bug' as const],
      labels: ['ui'],
      projects: [],
      mine: true,
      text: 'pay',
    };

    // Act
    const params = filtersToParams(filters);
    const back = filtersFromParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== null)) as Record<
        string,
        string
      >,
    );

    // Assert
    expect(params['project']).toBeNull();
    expect(back).toEqual(filters);
  });
});

describe('swimlanes', () => {
  const epic: BoardParent = {
    id: 'e1',
    key: 'WEB-10',
    title: 'Checkout',
    type: 'Epic',
    parentId: null,
  };
  const story: BoardParent = {
    id: 's1',
    key: 'WEB-11',
    title: 'Pay',
    type: 'UserStory',
    parentId: 'e1',
  };

  it('finds the epic one or two levels up', () => {
    // Arrange
    const parents = new Map([epic, story].map((p) => [p.id, p]));

    // Act / Assert
    expect(epicOf(card(1, { parentId: 'e1' }), parents)).toBe(epic);
    expect(epicOf(card(2, { parentId: 's1', type: 'Technical' }), parents)).toBe(epic);
    expect(epicOf(card(3), parents)).toBeNull();
  });

  it('groups by assignee with Unassigned last and keeps the board order per cell', () => {
    // Arrange
    const b = board(
      columns({
        ToDo: [
          card(1),
          card(2, { assigneeId: 'u2' }),
          card(3, { assigneeId: 'u1', storyPoints: 3 }),
        ],
        Done: [card(4, { assigneeId: 'u1' })],
      }),
    );

    // Act
    const lanes = buildLanes(b, EMPTY_FILTERS, 'assignee', null);

    // Assert
    expect(lanes.map((l) => l.label)).toEqual(['Ann', 'Bob', 'Unassigned']);
    expect(keys(lanes[0].cells.ToDo)).toEqual(['WEB-3']);
    expect(keys(lanes[0].cells.Done)).toEqual(['WEB-4']);
    expect([lanes[0].count, lanes[0].points]).toEqual([2, 3]);
  });

  it('groups by epic with "No epic" last and drops lanes emptied by filters', () => {
    // Arrange
    const b = board(
      columns({
        ToDo: [card(1), card(2, { parentId: 's1' }), card(3, { parentId: 'e1', assigneeId: 'u1' })],
      }),
      [epic, story],
    );

    // Act
    const all = buildLanes(b, EMPTY_FILTERS, 'epic', null);
    const mine = buildLanes(b, { ...EMPTY_FILTERS, mine: true }, 'epic', 'u1');
    const none = buildLanes(b, { ...EMPTY_FILTERS, text: 'nothing' }, 'none', null);

    // Assert
    expect(all.map((l) => l.label)).toEqual(['Checkout', 'No epic']);
    expect(keys(all[0].cells.ToDo)).toEqual(['WEB-2', 'WEB-3']);
    expect(mine.map((l) => l.key)).toEqual(['e1']);
    expect(none).toHaveLength(1);
    expect(none[0].count).toBe(0);
  });

  it('groups by project (by key, named) and by priority (Highest first)', () => {
    // Arrange
    const b = {
      ...board(
        columns({
          ToDo: [card(1, { projectKey: 'WEB', priority: 'Low' }), card(2, { projectKey: 'API' })],
          Done: [card(3, { projectKey: 'WEB', priority: 'Highest' })],
        }),
      ),
      projects: [
        { id: 'p1', key: 'WEB', name: 'Web shop', canWrite: true, isArchived: false, cardCount: 2 },
        {
          id: 'p2',
          key: 'API',
          name: 'Public API',
          canWrite: true,
          isArchived: false,
          cardCount: 1,
        },
      ],
    };

    // Act
    const byProject = buildLanes(b, EMPTY_FILTERS, 'project', null);
    const byPriority = buildLanes(b, EMPTY_FILTERS, 'priority', null);

    // Assert
    expect(byProject.map((l) => [l.key, l.label, l.count])).toEqual([
      ['API', 'Public API', 1],
      ['WEB', 'Web shop', 2],
    ]);
    expect(byPriority.map((l) => [l.priority, keys([...l.cells.ToDo, ...l.cells.Done])])).toEqual([
      ['Highest', ['WEB-3']],
      ['Medium', ['WEB-2']],
      ['Low', ['WEB-1']],
    ]);
  });

  it('reads swimlanes from the URL, falling back to none', () => {
    // Act
    const values = ['project', 'priority', 'epic', 'bogus', undefined].map(parseSwimlanes);

    // Assert
    expect(values).toEqual(['project', 'priority', 'epic', 'none', 'none']);
  });

  it('lists selected cards in board order', () => {
    // Arrange
    const cols = columns({ ToDo: [card(1), card(2)], Review: [card(3)] });

    // Act / Assert
    expect(inBoardOrder(cols, new Set(['id-3', 'id-1']))).toEqual(['id-1', 'id-3']);
  });
});
