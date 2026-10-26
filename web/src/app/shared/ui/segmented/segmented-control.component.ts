import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  inject,
  input,
  model,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface SegmentOption<T> {
  value: T;
  label?: string;
  icon?: string;
  ariaLabel?: string;
  count?: number;
}

/// Segmented control (radio group) with roving focus via arrow keys.
@Component({
  selector: 'tk-segmented',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'radiogroup',
    '[attr.aria-label]': 'ariaLabel()',
    '(keydown)': 'onKeydown($event)',
  },
  template: `
    @for (option of options(); track option.value) {
      <button
        type="button"
        role="radio"
        [class.on]="option.value === value()"
        [attr.aria-checked]="option.value === value()"
        [attr.aria-label]="option.ariaLabel ?? null"
        [attr.data-testid]="testId() ? testId() + '-' + option.value : null"
        [tabIndex]="option.value === value() ? 0 : -1"
        (click)="value.set(option.value)"
      >
        @if (option.icon) {
          <tk-icon [name]="option.icon" [size]="14" />
        }
        @if (option.label) {
          <span>{{ option.label }}</span>
        }
        @if (option.count !== undefined) {
          <span class="count">{{ option.count }}</span>
        }
      </button>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      padding: 2px;
      gap: 2px;
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-muted);
    }
    button {
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-sm);
      background: none;
      color: var(--tk-text-muted);
      font-weight: var(--tk-weight-medium);
      font-size: var(--tk-text-sm);
      cursor: pointer;
      transition: background var(--tk-duration-instant);
    }
    button:hover {
      color: var(--tk-text);
    }
    button.on {
      background: var(--tk-surface);
      color: var(--tk-text);
      box-shadow: var(--tk-shadow-xs);
    }
    .count {
      color: var(--tk-text-subtle);
      font-variant-numeric: tabular-nums;
    }
  `,
})
export class SegmentedControlComponent<T> {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input.required<readonly SegmentOption<T>[]>();
  readonly value = model.required<T>();
  readonly ariaLabel = input<string | null>(null);
  readonly testId = input<string | null>(null);

  protected onKeydown(event: KeyboardEvent): void {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!step) return;
    event.preventDefault();
    const options = this.options();
    const index = options.findIndex((o) => o.value === this.value());
    const next = (index + step + options.length) % options.length;
    this.value.set(options[next].value);
    queueMicrotask(() =>
      this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button')[next]?.focus(),
    );
  }
}
