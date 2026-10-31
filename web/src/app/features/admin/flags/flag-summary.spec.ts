import { groupFlags, targetingSummary } from './flag-summary';

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

describe('groupFlags', () => {
  it('lists declared flags by key and the retired ones last', () => {
    // Arrange
    const flags = [
      { key: 'ticket.subtickets-graph', retired: false },
      { key: 'old.feature', retired: true },
      { key: 'agent.delegate', retired: false },
      { key: 'a.gone', retired: true },
      { key: 'achievements', retired: false },
    ];

    // Act
    const { declared, retired } = groupFlags(flags);

    // Assert
    expect(declared.map((f) => f.key)).toEqual([
      'achievements',
      'agent.delegate',
      'ticket.subtickets-graph',
    ]);
    expect(retired.map((f) => f.key)).toEqual(['a.gone', 'old.feature']);
  });

  it('returns empty groups for no flags', () => {
    // Act / Assert
    expect(groupFlags([])).toEqual({ declared: [], retired: [] });
  });
});
