import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AgentPreferences } from './agent-preferences';

describe('AgentPreferences', () => {
  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
  });

  afterEach(() => localStorage.clear());

  it('remembers a folder per project key, case-insensitively', () => {
    // Arrange
    const preferences = TestBed.inject(AgentPreferences);

    // Act
    preferences.setFolder('tkt', 'C:\\src\\ticketing');

    // Assert
    expect(preferences.folder('TKT')).toBe('C:\\src\\ticketing');
    expect(JSON.parse(localStorage.getItem('tk-agent-folders') ?? '{}')).toEqual({
      TKT: 'C:\\src\\ticketing',
    });
  });

  it.each([
    ['a relative path', 'src\\ticketing'],
    ['a UNC share', '\\\\attacker\\share'],
    ['a parent segment', 'C:\\src\\..\\..\\Users'],
    ['a bidi override', 'C:\\src\\\u202eputsch'],
    ['a newline', 'C:\\src\nC:\\other'],
  ])('ignores a stored folder with %s, so the user is asked again', (_name, path) => {
    // Arrange
    localStorage.setItem('tk-agent-folders', JSON.stringify({ TKT: path, WEB: 'D:/web' }));

    // Act
    const preferences = TestBed.inject(AgentPreferences);

    // Assert
    expect(preferences.folder('TKT')).toBeNull();
    expect(preferences.folder('WEB')).toBe('D:/web');
  });
});
