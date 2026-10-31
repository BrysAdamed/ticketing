import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection } from '@angular/core';
import { PaletteItem } from './command';
import { CommandPaletteComponent } from './command-palette.component';
import { CommandRegistry } from './command-registry';

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setTimeout(resolve));
};

describe('CommandPaletteComponent', () => {
  let registry: CommandRegistry;
  let fixture: ComponentFixture<CommandPaletteComponent>;
  let ran: string[];
  let answer: (items: readonly PaletteItem[]) => void;

  const input = () =>
    fixture.nativeElement.querySelector(
      '[data-testid="command-palette-input"]',
    ) as HTMLInputElement;
  const key = (k: string) => input().dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  const selectedId = () =>
    (fixture.nativeElement.querySelector('[aria-selected="true"]') as HTMLElement).dataset[
      'testid'
    ];

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    registry = TestBed.inject(CommandRegistry);
    ran = [];
    registry.registerCommands([
      { id: 'first', label: 'Walkthrough intro', run: () => ran.push('first') },
      { id: 'second', label: 'Walkthrough tour', run: () => ran.push('second') },
    ]);
    registry.registerSearchProvider({
      id: 'remote',
      remote: true,
      search: () => new Promise((resolve) => (answer = resolve)),
    });
    fixture = TestBed.createComponent(CommandPaletteComponent);
    await fixture.whenStable();
    input().value = 'Walkthrough';
    input().dispatchEvent(new Event('input'));
    await fixture.whenStable();
    await new Promise<void>((resolve) => setTimeout(resolve, 150));
    expect(selectedId()).toBe('palette-item-command:second');
    key('ArrowDown');
    fixture.detectChanges();
    expect(selectedId()).toBe('palette-item-command:first');
  });

  it('keeps the item the user moved to active when remote results arrive above it', async () => {
    // Act
    answer([
      { id: 'ticket', label: 'Walkthrough ticket', group: 'Tickets', run: () => ran.push('other') },
    ]);
    await settle();
    fixture.detectChanges();
    key('Enter');

    // Assert
    expect(ran).toEqual(['first']);
  });

  it('keeps the item the user moved to active when a provider registers meanwhile', async () => {
    // Act
    registry.registerSearchProvider({
      id: 'late',
      search: () => [
        { id: 'late', label: 'Walkthrough late', group: 'Late', run: () => ran.push('other') },
      ],
    });
    await settle();
    fixture.detectChanges();
    key('Enter');

    // Assert
    expect(ran).toEqual(['first']);
  });

  it('starts again at the top when the query changes', async () => {
    // Act
    input().value = 'Walkthrough t';
    input().dispatchEvent(new Event('input'));
    await settle();
    fixture.detectChanges();

    // Assert
    expect(selectedId()).toBe('palette-item-command:second');
  });
});
