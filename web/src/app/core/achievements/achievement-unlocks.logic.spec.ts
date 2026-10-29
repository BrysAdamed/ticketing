import { UnseenAchievement } from './achievement.models';
import {
  freshUnlocks,
  planUnlockToasts,
  rememberToasted,
  summaryLine,
  summaryMedals,
  summaryTitle,
  unlockKey,
  unlockLine,
  UnlockToastItem,
  unlockTitle,
} from './achievement-unlocks.logic';

function unseen(id: string, tier = 1, name = id): UnseenAchievement {
  return { id, name, tier, icon: 'award' };
}

function item(id: string, tier = 1, tierCount = 4, name = id): UnlockToastItem {
  return { ...unseen(id, tier, name), tierCount, description: null };
}

describe('achievement unlocks', () => {
  describe('freshUnlocks', () => {
    it('returns the tiers not toasted yet, in the API order', () => {
      // Arrange
      const items = [unseen('reporter', 1), unseen('closer', 1), unseen('reporter', 2)];

      // Act
      const fresh = freshUnlocks(items, new Set(['reporter:1']));

      // Assert
      expect(fresh.map(unlockKey)).toEqual(['closer:1', 'reporter:2']);
    });

    it('returns nothing when every tier was toasted', () => {
      // Act
      const fresh = freshUnlocks([unseen('reporter')], new Set(['reporter:1']));

      // Assert
      expect(fresh).toEqual([]);
    });

    it('drops a tier the response repeats', () => {
      // Act
      const fresh = freshUnlocks([unseen('reporter'), unseen('reporter')], new Set());

      // Assert
      expect(fresh).toHaveLength(1);
    });
  });

  describe('rememberToasted', () => {
    it('adds the fresh tiers and forgets tiers no longer unseen', () => {
      // Arrange
      const now = [unseen('closer'), unseen('reporter', 2)];

      // Act
      const kept = rememberToasted(['reporter:1', 'closer:1'], [unseen('reporter', 2)], now);

      // Assert
      expect(kept.sort()).toEqual(['closer:1', 'reporter:2']);
    });

    it('forgets everything once nothing is unseen', () => {
      // Act
      const kept = rememberToasted(['reporter:1'], [], []);

      // Assert
      expect(kept).toEqual([]);
    });
  });

  describe('planUnlockToasts', () => {
    it('plans nothing for no unlocks', () => {
      expect(planUnlockToasts([])).toEqual([]);
    });

    it('plans one toast per tier up to three', () => {
      // Act
      const toasts = planUnlockToasts([item('a'), item('b'), item('c')]);

      // Assert
      expect(toasts.map((t) => t.kind)).toEqual(['single', 'single', 'single']);
    });

    it('collapses more than three into one summary', () => {
      // Arrange
      const items = [item('a'), item('b'), item('c'), item('d')];

      // Act
      const toasts = planUnlockToasts(items);

      // Assert
      expect(toasts).toEqual([{ kind: 'summary', items }]);
    });
  });

  describe('copy', () => {
    it('titles a tiered unlock with name and tier, a one-time one with its name', () => {
      expect(unlockTitle(item('closer', 2, 4, 'Closer'))).toBe('Closer · Silver');
      expect(unlockTitle(item('board-builder', 1, 1, 'Board builder'))).toBe('Board builder');
    });

    it('writes the description, or a neutral line without the catalogue', () => {
      expect(unlockLine({ ...item('closer'), description: 'Moved tickets to Done.' })).toBe(
        'Moved tickets to Done.',
      );
      expect(unlockLine(item('closer'))).toBe('New achievement unlocked.');
    });

    it('names three achievements and counts the rest in the summary', () => {
      // Arrange
      const items = [
        item('reporter', 1, 4, 'Reporter'),
        item('connector', 1, 3, 'Connector'),
        item('machine-whisperer', 1, 1, 'Machine whisperer'),
        item('board-builder', 1, 1, 'Board builder'),
        item('closer', 1, 4, 'Closer'),
      ];

      // Act & Assert
      expect(summaryTitle(items)).toBe('5 new achievements');
      expect(summaryLine(items)).toBe('Reporter, Connector, Machine whisperer and 2 more.');
    });

    it('names each achievement once in the summary', () => {
      // Arrange
      const items = [
        item('reporter', 1, 4, 'Reporter'),
        item('reporter', 2, 4, 'Reporter'),
        item('closer', 1, 4, 'Closer'),
        item('closer', 2, 4, 'Closer'),
      ];

      // Act & Assert
      expect(summaryLine(items)).toBe('Reporter and Closer.');
    });

    it('stacks the first three achievements at their highest new tier', () => {
      // Arrange
      const items = [item('a', 1), item('a', 2), item('b'), item('c'), item('d')];

      // Act
      const medals = summaryMedals(items);

      // Assert
      expect(medals.map((m) => unlockKey(m))).toEqual(['a:2', 'b:1', 'c:1']);
    });
  });
});
