import { userState } from './user-state';

const NOW = Date.parse('2026-10-26T12:00:00Z');
const future = new Date(NOW + 60_000).toISOString();
const past = new Date(NOW - 60_000).toISOString();

describe('userState', () => {
  it.each([
    [
      { isActive: false, hasPassword: true, setPasswordLinkExpiresAt: null, lockedUntil: future },
      'deactivated',
    ],
    [
      { isActive: true, hasPassword: false, setPasswordLinkExpiresAt: future, lockedUntil: null },
      'invited',
    ],
    [
      { isActive: true, hasPassword: false, setPasswordLinkExpiresAt: past, lockedUntil: null },
      'linkExpired',
    ],
    [
      { isActive: true, hasPassword: false, setPasswordLinkExpiresAt: null, lockedUntil: null },
      'linkExpired',
    ],
    [
      { isActive: true, hasPassword: true, setPasswordLinkExpiresAt: null, lockedUntil: future },
      'locked',
    ],
    [
      { isActive: true, hasPassword: true, setPasswordLinkExpiresAt: future, lockedUntil: past },
      'active',
    ],
  ] as const)('maps %o to %s', (user, expected) => {
    // Act / Assert
    expect(userState(user, NOW)).toBe(expected);
  });
});
