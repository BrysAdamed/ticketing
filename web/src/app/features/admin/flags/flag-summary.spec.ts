import { FLAG_KEY_PATTERN, targetingSummary } from './flag-summary';

describe('targetingSummary', () => {
  it.each([
    [{ rolloutPercentage: 100, targetRoles: ['Admin'], targetUsers: [] }, 'Everyone'],
    [{ rolloutPercentage: 0, targetRoles: [], targetUsers: [] }, 'Nobody targeted'],
    [
      { rolloutPercentage: 25, targetRoles: ['Admin'], targetUsers: [{}, {}, {}] },
      '25% of users · Roles: Admin · 3 users',
    ],
    [{ rolloutPercentage: 0, targetRoles: [], targetUsers: [{}] }, '1 user'],
  ] as const)('summarises %o as %s', (flag, expected) => {
    // Act / Assert
    expect(targetingSummary(flag)).toBe(expected);
  });
});

describe('FLAG_KEY_PATTERN', () => {
  it.each(['board.swimlanes', 'ticket-view.v2', 'a'])('accepts %s', (key) => {
    // Act / Assert
    expect(FLAG_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each(['Board', 'board..x', '1board', 'board.', 'board swimlanes'])('rejects %s', (key) => {
    // Act / Assert
    expect(FLAG_KEY_PATTERN.test(key)).toBe(false);
  });
});
