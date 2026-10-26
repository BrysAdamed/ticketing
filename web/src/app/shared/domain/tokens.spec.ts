import { expiresInLabel, tokenDisplayState } from './tokens';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();

describe('tokenDisplayState', () => {
  it('is revoked whenever the token was revoked, even if it also expired', () => {
    // Act
    const state = tokenDisplayState(
      { status: 'Revoked', expiresAt: iso(-DAY), revokedAt: iso(-2 * DAY) },
      NOW,
    );

    // Assert
    expect(state).toBe('revoked');
  });

  it('is expired once the expiry passed, whatever the server status said', () => {
    // Act
    const state = tokenDisplayState({ status: 'Active', expiresAt: iso(-1), revokedAt: null }, NOW);

    // Assert
    expect(state).toBe('expired');
  });

  it.each([
    [7 * DAY, 'expiring'],
    [7 * DAY + 1, 'active'],
    [DAY, 'expiring'],
  ])('with %d ms left is %s', (left, expected) => {
    // Act
    const state = tokenDisplayState(
      { status: 'Active', expiresAt: iso(left), revokedAt: null },
      NOW,
    );

    // Assert
    expect(state).toBe(expected);
  });
});

describe('expiresInLabel', () => {
  it.each([
    [2 * 60 * 60 * 1000, 'today'],
    [DAY + 1000, 'in 1 day'],
    [5 * DAY + 1000, 'in 5 days'],
  ])('formats %d ms ahead as %s', (ahead, expected) => {
    // Act / Assert
    expect(expiresInLabel(iso(ahead), NOW)).toBe(expected);
  });
});
