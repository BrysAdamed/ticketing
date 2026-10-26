import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  model,
} from '@angular/core';
import { PROJECT_VISIBILITIES, ProjectVisibility } from '@shared/domain/enums';
import { IconComponent } from '../icon/icon.component';

const CARDS: Record<ProjectVisibility, { icon: string; title: string; description: string }> = {
  Private: {
    icon: 'tablerLock',
    title: 'Private',
    description: 'Only members can see it. Admins see every project.',
  },
  Public: {
    icon: 'tablerWorld',
    title: 'Public',
    description: 'Everyone signed in can see it and create or edit tickets.',
  },
};

/// Project visibility as two radio cards with the consequence spelled out (public = everyone can
/// edit, spec 5.1 / D-02). Arrow keys move the choice.
@Component({
  selector: 'tk-visibility-cards',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'radiogroup',
    '[attr.aria-labelledby]': 'labelledBy()',
    '[attr.aria-disabled]': 'disabled()',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    @for (option of options; track option) {
      <button
        type="button"
        role="radio"
        class="card"
        [class.on]="option === value()"
        [attr.aria-checked]="option === value()"
        [attr.data-testid]="'visibility-' + option"
        [tabIndex]="option === value() ? 0 : -1"
        [disabled]="disabled()"
        (click)="value.set(option)"
      >
        <tk-icon class="icon" [name]="cards[option].icon" [size]="16" />
        <span class="text">
          <span class="title">{{ cards[option].title }}</span>
          <span class="description">{{ cards[option].description }}</span>
        </span>
      </button>
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 8px;
    }
    .card {
      display: flex;
      gap: 10px;
      align-items: flex-start;
      padding: 10px 12px;
      border: 1px solid var(--tk-border-strong);
      border-radius: var(--tk-radius-lg);
      background: var(--tk-surface);
      color: var(--tk-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        border-color var(--tk-duration-instant),
        background var(--tk-duration-instant);
    }
    .card:hover:not([disabled]) {
      background: var(--tk-bg-hover);
    }
    .card.on {
      border-color: var(--tk-accent);
      background: var(--tk-accent-subtle);
      box-shadow: 0 0 0 1px var(--tk-accent);
    }
    .card[disabled] {
      cursor: default;
      opacity: 0.7;
    }
    .card:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: 2px;
    }
    .icon {
      margin-top: 2px;
      color: var(--tk-text-muted);
    }
    .card.on .icon {
      color: var(--tk-accent-fg);
    }
    .text {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .title {
      font-weight: var(--tk-weight-medium);
    }
    .description {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
    }
  `,
})
export class VisibilityCardsComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly value = model<ProjectVisibility>('Private');
  readonly disabled = input(false);
  readonly labelledBy = input<string | null>(null);

  protected readonly options = PROJECT_VISIBILITIES;
  protected readonly cards = CARDS;

  protected onKeydown(event: KeyboardEvent): void {
    if (this.disabled() || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key))
      return;
    event.preventDefault();
    const index = this.options.indexOf(this.value());
    const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    const next = this.options[(index + step + this.options.length) % this.options.length];
    this.value.set(next);
    queueMicrotask(() =>
      this.host.nativeElement
        .querySelector<HTMLButtonElement>(`[data-testid="visibility-${next}"]`)
        ?.focus(),
    );
  }
}
