import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { InlinePickerPanelComponent } from './inline-picker-panel.component';
import { PickerOption } from './picker-option';

@Component({
  imports: [InlinePickerPanelComponent],
  template: `
    <ng-template #footer>
      @if (hintShown()) {
        <div role="note">
          <button type="button" data-testid="hint-dismiss" (click)="hintShown.set(false)">×</button>
        </div>
      }
    </ng-template>
    <tk-inline-picker-panel
      [options]="options"
      [footer]="withFooter() ? footer : null"
      (dismissed)="closed = closed + 1"
    />
  `,
})
class HostComponent {
  readonly options: PickerOption<string>[] = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];
  readonly withFooter = signal(true);
  readonly hintShown = signal(true);
  closed = 0;
}

describe('InlinePickerPanelComponent footer keyboard access', () => {
  async function render(withFooter = true) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.withFooter.set(withFooter);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.focus();
    return {
      fixture,
      input,
      dismiss: () => root.querySelector<HTMLButtonElement>('[data-testid="hint-dismiss"]'),
    };
  }

  function press(target: Element, key: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
  }

  afterEach(() => TestBed.resetTestingModule());

  it('closes on Tab when there is no footer', async () => {
    // Arrange
    const { fixture, input } = await render(false);

    // Act
    press(input, 'Tab');

    // Assert
    expect(fixture.componentInstance.closed).toBe(1);
  });

  it('moves Tab from the filter to the footer button and Shift+Tab back', async () => {
    // Arrange
    const { fixture, input, dismiss } = await render();

    // Act
    const tab = press(input, 'Tab');

    // Assert
    expect(tab.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(dismiss());
    expect(fixture.componentInstance.closed).toBe(0);

    // Act
    const back = press(dismiss()!, 'Tab', true);

    // Assert
    expect(back.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('closes on Tab past the footer and on Escape inside it', async () => {
    // Arrange
    const { fixture, input, dismiss } = await render();
    press(input, 'Tab');

    // Act
    press(dismiss()!, 'Tab');
    press(dismiss()!, 'Escape');

    // Assert
    expect(fixture.componentInstance.closed).toBe(2);
  });

  it('returns focus to the filter when the footer button disappears after activation', async () => {
    // Arrange
    const { fixture, input, dismiss } = await render();
    press(input, 'Tab');

    // Act
    dismiss()!.click();
    await fixture.whenStable();

    // Assert
    expect(dismiss()).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(fixture.componentInstance.closed).toBe(0);
  });

  it('closes on Tab once the footer has nothing focusable left', async () => {
    // Arrange
    const { fixture, input } = await render();
    fixture.componentInstance.hintShown.set(false);
    await fixture.whenStable();

    // Act
    press(input, 'Tab');

    // Assert
    expect(fixture.componentInstance.closed).toBe(1);
  });
});
