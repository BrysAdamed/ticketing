import { OnboardingChecklistItem } from '../onboarding.models';
import {
  canWriteSomewhere,
  checklistProgress,
  groupChecklist,
  nextChecklistItem,
} from './checklist.model';

function item(id: string, done = false, optional = false): OnboardingChecklistItem {
  return { id, done, optional };
}

const OWNER: OnboardingChecklistItem[] = [
  item('create-ticket', true),
  item('move-work', true),
  item('join-conversation'),
  item('follow-ticket', true),
  item('invite-team'),
  item('plan-on-board'),
  item('write-test-case'),
  item('run-regression'),
  item('agent-token', true, true),
  item('agent-connected', false, true),
];

describe('checklist model', () => {
  it('counts only required items, so optional ones never hold completion back', () => {
    // Act
    const progress = checklistProgress(OWNER);

    // Assert
    expect(progress).toEqual({ done: 3, total: 8, complete: false });
  });

  it('is complete when every required item is done, whatever the optional ones say', () => {
    // Arrange
    const items = [item('follow-ticket', true), item('agent-token', false, true)];

    // Act
    const progress = checklistProgress(items);

    // Assert
    expect(progress).toEqual({ done: 1, total: 1, complete: true });
  });

  it('is never complete without required items', () => {
    // Act
    const progress = checklistProgress([item('agent-token', true, true)]);

    // Assert
    expect(progress.complete).toBe(false);
  });

  it('groups items in display order and leaves out empty groups and unknown ids', () => {
    // Arrange
    const items = [...OWNER, item('some-future-item')];

    // Act
    const groups = groupChecklist(items);

    // Assert
    expect(groups.map((g) => [g.id, g.entries.map((e) => e.id)])).toEqual([
      ['start', ['create-ticket', 'move-work', 'join-conversation', 'follow-ticket']],
      ['projects', ['invite-team', 'plan-on-board', 'write-test-case', 'run-regression']],
      ['agent', ['agent-token', 'agent-connected']],
    ]);
    expect(groups.find((g) => g.id === 'agent')?.optional).toBe(true);
    expect(checklistProgress(items).total).toBe(8);
  });

  it('points at the first open required item as the next step', () => {
    // Act
    const next = nextChecklistItem(OWNER);

    // Assert
    expect(next).toBe('join-conversation');
    expect(nextChecklistItem([item('follow-ticket', true), item('agent-token', false, true)])).toBe(
      null,
    );
  });

  it('tells whether the user got any write item', () => {
    // Assert
    expect(canWriteSomewhere(OWNER)).toBe(true);
    expect(canWriteSomewhere([item('follow-ticket'), item('agent-token', false, true)])).toBe(
      false,
    );
  });
});
