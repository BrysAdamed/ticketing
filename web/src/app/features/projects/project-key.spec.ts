import {
  normalizeProjectKeyInput,
  PROJECT_KEY_PATTERN,
  projectKeyError,
  suggestProjectKey,
} from './project-key';

describe('suggestProjectKey', () => {
  it.each([
    ['Customer Portal', 'CP'],
    ['Payments', 'PAYM'],
    ['Web', 'WEB'],
    ['payments platform v2', 'PPV'],
    ['Éclair Café', 'EC'],
    ['2024 Roadmap', 'ROAD'],
    ['A', 'AX'],
    ['  ', ''],
    ['123', ''],
  ])('suggests a valid key for "%s"', (name, expected) => {
    // Act
    const key = suggestProjectKey(name);

    // Assert
    expect(key).toBe(expected);
    if (key) expect(key).toMatch(PROJECT_KEY_PATTERN);
  });

  it('caps long initials at 10 characters', () => {
    // Act
    const key = suggestProjectKey('a b c d e f g h i j k l');

    // Assert
    expect(key).toBe('ABCDEFGHIJ');
  });
});

describe('projectKeyError', () => {
  it.each([
    ['', 'Enter a key.'],
    ['1WEB', 'The key must start with a letter.'],
    ['WEB-1', 'Use only letters A–Z and digits.'],
    ['W', 'Use at least 2 characters.'],
    ['ABCDEFGHIJK', 'Use at most 10 characters.'],
  ])('rejects "%s"', (key, message) => {
    // Act / Assert
    expect(projectKeyError(key)).toBe(message);
  });

  it('accepts a valid key', () => {
    // Act / Assert
    expect(projectKeyError('CORE2')).toBeNull();
  });

  it('upper-cases typed input and drops spaces', () => {
    // Act / Assert
    expect(normalizeProjectKeyInput('we b')).toBe('WEB');
  });
});
