import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { PickerOption } from '../inline-picker/picker-option';
import { SearchPickerPanelComponent } from './search-picker-panel.component';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe('SearchPickerPanelComponent', () => {
  async function setup(hint: string | null = null) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const search = vi.fn(async (query: string): Promise<PickerOption<string>[]> => {
      await wait(30);
      return query
        ? [{ value: `match:${query}`, label: query }]
        : [{ value: 'first', label: 'First' }];
    });
    const fixture = TestBed.createComponent(SearchPickerPanelComponent<string>);
    fixture.componentRef.setInput('search', search);
    fixture.componentRef.setInput('hint', hint);
    const picked: string[] = [];
    fixture.componentInstance.picked.subscribe((value) => picked.push(value));
    await fixture.whenStable();
    await wait(50);
    await fixture.whenStable();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    return { fixture, input, picked };
  }

  function type(input: HTMLInputElement, value: string): void {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }

  function enter(input: HTMLInputElement): void {
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
  }

  it('picks the match for the typed text when Enter comes before the results', async () => {
    // Arrange
    const { input, picked } = await setup();

    // Act
    type(input, 'zed');
    enter(input);
    await wait(250);

    // Assert
    expect(picked).toEqual(['match:zed']);
  });

  it('picks the highlighted option at once when nothing is pending', async () => {
    // Arrange
    const { input, picked } = await setup();

    // Act
    enter(input);

    // Assert
    expect(picked).toEqual(['first']);
  });

  it('shows the hint until something is typed', async () => {
    // Arrange
    const { fixture, input } = await setup('Showing the first 1000 projects, type to search');
    const hint = () => fixture.nativeElement.querySelector('[data-testid="search-picker-hint"]');
    const before = hint()?.textContent?.trim();

    // Act
    type(input, 'a');
    await fixture.whenStable();

    // Assert
    expect(before).toBe('Showing the first 1000 projects, type to search');
    expect(hint()).toBeNull();
  });
});
