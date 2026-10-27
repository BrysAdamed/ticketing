import {
  childKeys,
  mayHaveChildren,
  moveChildrenPrompt,
  skippedChildren,
} from './move-children-prompt';
import { MoveChildrenParent, MoveChildrenPreview, TicketSummary } from './ticket.models';

const SPRINT = { kind: 'board', name: 'Sprint 1' } as const;
const BACKLOG = { kind: 'backlog' } as const;

function child(key: string): TicketSummary {
  return { key } as TicketSummary;
}

function parent(
  key: string,
  children: string[],
  skipped: Partial<Pick<MoveChildrenParent, 'onOtherBoard' | 'inBacklog' | 'done'>> = {},
): MoveChildrenParent {
  return {
    key,
    children: children.map(child),
    onOtherBoard: 0,
    inBacklog: 0,
    done: 0,
    ...skipped,
  };
}

function preview(
  parents: MoveChildrenParent[],
  skipped: Partial<Pick<MoveChildrenPreview, 'onOtherBoard' | 'inBacklog' | 'done'>> = {},
): MoveChildrenPreview {
  return {
    parents,
    count: parents.reduce((sum, p) => sum + p.children.length, 0),
    onOtherBoard: 0,
    inBacklog: 0,
    done: 0,
    ...skipped,
  };
}

describe('mayHaveChildren', () => {
  it('is false when no ticket has children, so the preview is not fetched', () => {
    expect(mayHaveChildren([0, 0])).toBe(false);
    expect(mayHaveChildren([])).toBe(false);
  });

  it('is true when one ticket has children', () => {
    expect(mayHaveChildren([0, 3])).toBe(true);
  });
});

describe('moveChildrenPrompt', () => {
  it('asks about one parent leaving the backlog', () => {
    // Arrange
    const p = preview([parent('TKT-25', ['TKT-26', 'TKT-27', 'TKT-28', 'A-1', 'A-2', 'A-3'])]);

    // Act
    const prompt = moveChildrenPrompt(p, BACKLOG, SPRINT);

    // Assert
    expect(prompt?.message).toBe(
      'TKT-25 has 6 sub-tickets in the backlog. Move them to Sprint 1 too?',
    );
    expect(prompt?.detail).toBeNull();
  });

  it('sums several parents into one question', () => {
    // Arrange
    const p = preview([
      parent('A-1', ['A-4', 'A-5', 'A-6']),
      parent('A-2', ['A-7', 'A-8']),
      parent('A-3', ['A-9', 'A-10', 'A-11', 'A-12']),
    ]);

    // Act
    const prompt = moveChildrenPrompt(p, BACKLOG, SPRINT);

    // Assert
    expect(prompt?.message).toBe(
      '3 selected tickets have 9 sub-tickets in the backlog. Move them to Sprint 1 too?',
    );
  });

  it('names the only parent with children when other selected tickets have none', () => {
    // Arrange
    const p = preview([parent('A-1', []), parent('A-2', ['A-3'])]);

    // Act
    const prompt = moveChildrenPrompt(p, BACKLOG, SPRINT);

    // Assert
    expect(prompt?.message).toBe('A-2 has 1 sub-ticket in the backlog. Move it to Sprint 1 too?');
  });

  it('says "on this board" leaving a board and "the backlog" as the target', () => {
    // Arrange
    const p = preview([parent('A-1', ['A-2', 'A-3'])]);

    // Act
    const prompt = moveChildrenPrompt(p, { kind: 'board' }, BACKLOG);

    // Assert
    expect(prompt?.message).toBe(
      'A-1 has 2 sub-tickets on this board. Move them to the backlog too?',
    );
  });

  it('names the source board when given', () => {
    // Arrange
    const p = preview([parent('A-1', ['A-2', 'A-3'])]);

    // Act
    const prompt = moveChildrenPrompt(
      p,
      { kind: 'board', name: 'Sprint 1' },
      {
        kind: 'board',
        name: 'Sprint 2',
      },
    );

    // Assert
    expect(prompt?.message).toBe('A-1 has 2 sub-tickets on Sprint 1. Move them to Sprint 2 too?');
  });

  it('adds the skipped line', () => {
    // Arrange
    const p = preview([parent('A-1', ['A-2'], { onOtherBoard: 2, done: 1 })], {
      onOtherBoard: 2,
      done: 1,
    });

    // Act
    const prompt = moveChildrenPrompt(p, BACKLOG, SPRINT);

    // Assert
    expect(prompt?.detail).toBe('2 are on another board, 1 is Done');
  });

  it('does not ask when no child would come along, even if some are skipped', () => {
    // Arrange
    const p = preview([parent('A-1', [], { done: 3 })], { done: 3 });

    // Act
    const prompt = moveChildrenPrompt(p, BACKLOG, SPRINT);

    // Assert
    expect(prompt).toBeNull();
  });
});

describe('skippedChildren', () => {
  it('lists the non-zero parts in a fixed order with the right verb', () => {
    expect(skippedChildren({ onOtherBoard: 1, inBacklog: 3, done: 2 })).toBe(
      '1 is on another board, 3 are in the backlog, 2 are Done',
    );
    expect(skippedChildren({ onOtherBoard: 0, inBacklog: 1, done: 0 })).toBe('1 is in the backlog');
  });

  it('is null when nothing is skipped', () => {
    expect(skippedChildren({ onOtherBoard: 0, inBacklog: 0, done: 0 })).toBeNull();
  });
});

describe('childKeys', () => {
  it('flattens the children of every parent in placement order', () => {
    // Arrange
    const p = preview([parent('A-1', ['A-3', 'A-4']), parent('A-2', ['A-5'])]);

    // Act
    const keys = childKeys(p);

    // Assert
    expect(keys).toEqual(['A-3', 'A-4', 'A-5']);
  });
});
