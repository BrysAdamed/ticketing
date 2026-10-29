import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EmptyStateComponent } from './empty-state.component';

@Component({
  imports: [EmptyStateComponent],
  template: `
    <tk-empty-state title="Nothing here" [learnLabel]="label()" (learn)="learned = learned + 1">
      <button type="button" data-testid="create">Create</button>
    </tk-empty-state>
  `,
})
class HostComponent {
  readonly label = signal<string | null>(null);
  learned = 0;
}

describe('EmptyStateComponent', () => {
  async function render(label: string | null) {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(HostComponent);
    fixture.componentInstance.label.set(label);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      root,
      learn: () => root.querySelector<HTMLButtonElement>('[data-testid="empty-state-learn"]'),
    };
  }

  it('has no learn action without a label', async () => {
    // Arrange / Act
    const { root, learn } = await render(null);

    // Assert
    expect(learn()).toBeNull();
    expect(root.querySelector('[data-testid="create"]')).not.toBeNull();
  });

  it('shows the learn action after the projected actions and emits on click', async () => {
    // Arrange
    const { fixture, root, learn } = await render('Take the tour');

    // Act
    learn()!.click();

    // Assert
    const buttons = [...root.querySelectorAll('.actions button')];
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Create', 'Take the tour']);
    expect(fixture.componentInstance.learned).toBe(1);
  });
});
