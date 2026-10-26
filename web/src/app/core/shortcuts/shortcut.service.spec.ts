import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { normalizeKeys, ShortcutService } from './shortcut.service';

const press = (key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) =>
  target.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
  );

describe('ShortcutService', () => {
  let service: ShortcutService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    service = TestBed.inject(ShortcutService);
  });

  it('fires single-key, chord and sequence shortcuts', () => {
    // Arrange
    const calls: string[] = [];
    service.register({ keys: '?', description: 'help', handler: () => calls.push('?') });
    service.register({ keys: 'mod+k', description: 'palette', handler: () => calls.push('k') });
    service.register({ keys: 'g b', description: 'backlog', handler: () => calls.push('gb') });

    // Act
    press('?', { shiftKey: true });
    press('k', { ctrlKey: true, metaKey: true });
    press('g');
    press('b');

    // Assert
    expect(calls).toContain('?');
    expect(calls).toContain('k');
    expect(calls).toContain('gb');
  });

  it('ignores single keys typed into inputs unless allowed', () => {
    // Arrange
    const input = document.createElement('input');
    document.body.appendChild(input);
    let plain = 0;
    let allowed = 0;
    service.register({ keys: 'c', description: 'create', handler: () => plain++ });
    service.register({
      keys: 'escape',
      description: 'close',
      handler: () => allowed++,
      allowInInputs: true,
    });

    // Act
    press('c', {}, input);
    press('Escape', {}, input);

    // Assert
    expect(plain).toBe(0);
    expect(allowed).toBe(1);
    input.remove();
  });

  it('lets the latest registration override and restores the previous one on removal', () => {
    // Arrange
    const calls: string[] = [];
    service.register({ keys: '/', description: 'global', handler: () => calls.push('global') });
    const remove = service.register({
      keys: '/',
      description: 'page',
      handler: () => calls.push('page'),
    });

    // Act
    press('/');
    remove();
    press('/');

    // Assert
    expect(calls).toEqual(['page', 'global']);
  });

  it('normalizes key notation', () => {
    expect(normalizeKeys('Shift+Mod+K')).toBe('mod+shift+k');
    expect(normalizeKeys('G  B')).toBe('g b');
    expect(normalizeKeys('esc')).toBe('escape');
  });
});
