import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/// Character count against a limit that must not be reached (`length < limit`). Turns amber in
/// the last 10 % and red at the limit. `estimated` marks a count that awaits the server's figure.
@Component({
  selector: 'tk-length-meter',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'status',
    'data-testid': 'length-meter',
    '[attr.data-tone]': 'tone()',
    '[attr.aria-label]': 'label()',
  },
  template: `
    <span class="tnum">{{ estimated() ? '≈ ' : '' }}{{ length() | number }}</span>
    <span class="limit tnum">/ {{ limit() | number }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      gap: 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    :host([data-tone='warning']) {
      color: var(--tk-warning-fg);
    }
    :host([data-tone='danger']) {
      color: var(--tk-danger-fg);
      font-weight: var(--tk-weight-medium);
    }
    .limit {
      color: var(--tk-text-subtle);
    }
  `,
})
export class LengthMeterComponent {
  readonly length = input.required<number>();
  readonly limit = input.required<number>();
  readonly estimated = input(false);

  protected readonly tone = computed(() => {
    const ratio = this.length() / this.limit();
    return ratio >= 1 ? 'danger' : ratio >= 0.9 ? 'warning' : 'ok';
  });
  protected readonly label = computed(
    () => `${this.length()} of at most ${this.limit() - 1} characters, guardrails included`,
  );
}
