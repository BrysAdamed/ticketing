import { SharedMedal, showManageLink, userCardSection } from './user-card.logic';

const REPORTER: SharedMedal = { id: 'reporter', name: 'Reporter', icon: 'file-plus', tier: 2 };
const BOARD_BUILDER: SharedMedal = {
  id: 'board-builder',
  name: 'Board builder',
  icon: 'layout-kanban',
  tier: 1,
};

describe('user card logic', () => {
  it('lists a teammate’s shared achievements in the order the API returns', () => {
    // Act
    const section = userCardSection({ status: 'loaded', items: [REPORTER, BOARD_BUILDER] }, false);

    // Assert
    expect(section?.heading).toBe('Shared achievements');
    expect(section?.items.map((i) => i.id)).toEqual(['reporter', 'board-builder']);
    expect(section?.items.map((i) => i.tierText)).toEqual(['Silver', 'Earned']);
    expect(section?.items.map((i) => i.label)).toEqual([
      'Reporter, Silver',
      'Board builder, earned',
    ]);
    expect(section?.items.map((i) => i.tierCount)).toEqual([4, 1]);
  });

  it('says "Shared by you" on your own card', () => {
    // Act
    const section = userCardSection({ status: 'loaded', items: [REPORTER] }, true);

    // Assert
    expect(section?.heading).toBe('Shared by you');
  });

  it.each([
    ['achievements are off for the viewer', { status: 'off' as const }],
    ['the shares are still loading', { status: 'loading' as const }],
    ['the API answered 404 or failed', { status: 'hidden' as const }],
    ['the person shares nothing', { status: 'loaded' as const, items: [] }],
  ])('has no achievements section while %s', (_case, state) => {
    // Act / Assert
    expect(userCardSection(state, false)).toBeNull();
    expect(userCardSection(state, true)).toBeNull();
  });

  it('links your own card to Profile → Achievements once your shares loaded', () => {
    // Act / Assert
    expect(showManageLink({ status: 'loaded', items: [] }, true)).toBe(true);
    expect(showManageLink({ status: 'loaded', items: [REPORTER] }, false)).toBe(false);
    expect(showManageLink({ status: 'off' }, true)).toBe(false);
    expect(showManageLink({ status: 'hidden' }, true)).toBe(false);
  });
});
