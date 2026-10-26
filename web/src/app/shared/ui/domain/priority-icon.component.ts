import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { Priority, PRIORITY_LABELS } from '@shared/domain/enums';

const LIT_BARS: Record<Priority, number> = { Highest: 3, High: 3, Medium: 2, Low: 1, Lowest: 0 };

const BARS = [
  { x: 1.5, y: 8, h: 4.5 },
  { x: 5.75, y: 5, h: 7.5 },
  { x: 10, y: 2, h: 10.5 },
];

/// Priority signal bars (design-system §8). Icon-only; the label is exposed to assistive tech.
@Component({
  selector: 'tk-priority-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': '"Priority: " + label()',
    '[attr.title]': 'showTitle() ? "Priority: " + label() : null',
    '[style.color]': 'color()',
  },
  template: `
    <svg viewBox="0 0 14 14" [attr.width]="size()" [attr.height]="size()">
      @if (priority() === 'Highest') {
        <rect x="1" y="1" width="12" height="12" rx="3" fill="currentColor" />
        <path d="M7 3.8v4" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" />
        <circle cx="7" cy="10.2" r="1" fill="#fff" />
      } @else {
        @for (bar of bars; track $index) {
          <rect
            [attr.x]="bar.x"
            [attr.y]="bar.y"
            width="2.5"
            [attr.height]="bar.h"
            rx=".75"
            [style.fill]="$index < lit() ? 'currentColor' : 'var(--tk-priority-bar-off)'"
          />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }
  `,
})
export class PriorityIconComponent {
  readonly priority = input.required<Priority>();
  readonly size = input(14);
  readonly showTitle = input(true);

  protected readonly bars = BARS;
  protected readonly label = computed(() => PRIORITY_LABELS[this.priority()]);
  protected readonly lit = computed(() => LIT_BARS[this.priority()]);
  protected readonly color = computed(() => {
    switch (this.priority()) {
      case 'Highest':
        return 'var(--tk-priority-highest)';
      case 'High':
        return 'var(--tk-priority-high)';
      default:
        return 'var(--tk-priority-bar)';
    }
  });
}
