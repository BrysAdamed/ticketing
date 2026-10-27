import { badgeText, bellLabel, dayLabel, groupByDay, moreLabel } from './notification-format';
import { UserNotification } from './notification.models';

const NOW = new Date(2026, 9, 27, 9, 30);

function notification(id: string, createdAt: Date): UserNotification {
  return {
    id,
    kind: 'Commented',
    summary: 'commented',
    eventCount: 1,
    actor: null,
    projectKey: 'PAY',
    ticket: { key: 'PAY-1', title: 'Pay', deleted: false },
    regression: null,
    doc: null,
    url: '/tickets/PAY-1',
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    readAt: null,
  };
}

describe('notification format', () => {
  it('labels days as Today, Yesterday, then weekday and date', () => {
    // Arrange
    const cases: [Date, string][] = [
      [new Date(2026, 9, 27, 0, 1), 'Today'],
      [new Date(2026, 9, 26, 23, 59), 'Yesterday'],
      [new Date(2026, 9, 25, 12, 0), 'Sun, Oct 25'],
      [new Date(2025, 11, 31, 12, 0), 'Wed, Dec 31, 2025'],
    ];

    // Act
    const labels = cases.map(([date]) => dayLabel(date, NOW));

    // Assert
    expect(labels).toEqual(cases.map(([, label]) => label));
  });

  it('groups consecutive notifications by the day they were created', () => {
    // Arrange
    const items = [
      notification('a', new Date(2026, 9, 27, 9, 0)),
      notification('b', new Date(2026, 9, 27, 8, 0)),
      notification('c', new Date(2026, 9, 26, 18, 0)),
      notification('d', new Date(2026, 9, 22, 18, 0)),
    ];

    // Act
    const groups = groupByDay(items, NOW);

    // Assert
    expect(groups.map((g) => [g.label, g.items.map((n) => n.id)])).toEqual([
      ['Today', ['a', 'b']],
      ['Yesterday', ['c']],
      ['Thu, Oct 22', ['d']],
    ]);
  });

  it('caps the badge at 99+ and hides it at zero', () => {
    // Act
    const texts = [0, 1, 99, 100, 1234].map(badgeText);

    // Assert
    expect(texts).toEqual([null, '1', '99', '99+', '99+']);
    expect(bellLabel(0)).toBe('Notifications');
    expect(bellLabel(3)).toBe('Notifications, 3 unread');
  });

  it('shows how many more events a collapsed notification holds', () => {
    // Act
    const labels = [1, 2, 5].map(moreLabel);

    // Assert
    expect(labels).toEqual([null, '+1 more', '+4 more']);
  });
});
