import { PatSummary } from '@shared/domain/tokens';
import { connectAgentState, connectionTarget, suggestTokenName } from './connect-agent.logic';

const NOW = Date.parse('2026-10-28T12:00:00Z');

function token(id: string, patch: Partial<PatSummary> = {}): PatSummary {
  return {
    id,
    name: id,
    prefix: 'tkt_abcd',
    scope: 'ReadWrite',
    status: 'Active',
    createdAt: '2026-10-01T00:00:00Z',
    expiresAt: '2027-01-01T00:00:00Z',
    lastUsedAt: null,
    revokedAt: null,
    ...patch,
  };
}

describe('connect agent guide', () => {
  it('suggests Claude Code, numbered when the name is taken', () => {
    // Act
    const free = suggestTokenName([{ name: 'CI' }]);
    const taken = suggestTokenName([{ name: 'claude code' }, { name: 'Claude Code 2' }]);

    // Assert
    expect(free).toBe('Claude Code');
    expect(taken).toBe('Claude Code 3');
  });

  it('starts at step 1 without a live token and does not poll', () => {
    // Act
    const state = connectAgentState(
      [token('old', { status: 'Revoked', revokedAt: '2026-10-02T00:00:00Z' })],
      null,
      false,
      NOW,
    );

    // Assert
    expect([state.step1, state.step2, state.step3]).toEqual(['current', 'upcoming', 'upcoming']);
    expect(state.target).toBeNull();
    expect(state.polling).toBe(false);
  });

  it('moves to the command once a token exists and polls until it is used', () => {
    // Act
    const created = connectAgentState([token('new')], 'new', false, NOW);
    const copied = connectAgentState([token('new')], 'new', true, NOW);

    // Assert
    expect([created.step1, created.step2, created.step3]).toEqual(['done', 'current', 'upcoming']);
    expect(created.polling).toBe(true);
    expect([copied.step2, copied.step3]).toEqual(['done', 'current']);
    expect(copied.connected).toBe(false);
  });

  it('turns green when the watched token has been used', () => {
    // Act
    const state = connectAgentState(
      [token('new', { lastUsedAt: '2026-10-28T11:59:00Z' })],
      'new',
      false,
      NOW,
    );

    // Assert
    expect([state.step1, state.step2, state.step3]).toEqual(['done', 'done', 'done']);
    expect(state.connected).toBe(true);
    expect(state.polling).toBe(false);
  });

  it('watches the token created in the guide, not an older used one', () => {
    // Arrange
    const tokens = [token('new'), token('old', { lastUsedAt: '2026-10-20T00:00:00Z' })];

    // Act
    const state = connectAgentState(tokens, 'new', true, NOW);

    // Assert
    expect(state.target?.id).toBe('new');
    expect(state.connected).toBe(false);
  });

  it('without a token from the guide, prefers a live token that was used', () => {
    // Arrange
    const tokens = [
      token('unused'),
      token('used', { lastUsedAt: '2026-10-20T00:00:00Z' }),
      token('expired', { expiresAt: '2026-10-01T00:00:00Z', lastUsedAt: '2026-09-20T00:00:00Z' }),
    ];

    // Act
    const target = connectionTarget(tokens, null, NOW);
    const onlyExpired = connectionTarget([tokens[2]], null, NOW);

    // Assert
    expect(target?.id).toBe('used');
    expect(onlyExpired).toBeNull();
  });
});
