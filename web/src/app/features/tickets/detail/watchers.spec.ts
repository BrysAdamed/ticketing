import { describe, expect, it } from 'vitest';
import { UserRef, Watchers } from '@core/tickets/ticket.models';
import { withoutWatcher, withWatcher } from './watchers';

const user = (id: string, displayName: string): UserRef => ({
  id,
  email: `${id}@x.test`,
  displayName,
  isActive: true,
});

describe('optimistic watcher lists', () => {
  const ann = user('ann', 'Ann');
  const zoe = user('zoe', 'zoe');
  const me = user('me', 'Mia');

  it('adds the user once, in name order', () => {
    // Arrange
    const watchers: Watchers = { count: 2, watching: false, users: [ann, zoe] };

    // Act
    const added = withWatcher(watchers, me);
    const again = withWatcher(added, me);

    // Assert
    expect(added).toEqual({ count: 3, watching: true, users: [ann, me, zoe] });
    expect(again).toEqual(added);
  });

  it('removes the user and keeps the count when they were not listed', () => {
    // Arrange
    const watchers: Watchers = { count: 2, watching: true, users: [ann, me] };

    // Act
    const removed = withoutWatcher(watchers, me.id);
    const unlisted = withoutWatcher({ count: 1, watching: true, users: [ann] }, me.id);

    // Assert
    expect(removed).toEqual({ count: 1, watching: false, users: [ann] });
    expect(unlisted).toEqual({ count: 1, watching: false, users: [ann] });
  });
});
