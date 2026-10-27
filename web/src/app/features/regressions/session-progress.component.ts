import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RegressionSummary } from '@core/testing/testing.models';
import { progressSegments } from './session/session-logic';

/// Segmented session progress bar (design-system §8): passed, failed, skipped, waiting, with 2px gaps.
@Component({
  selector: 'tk-session-progress',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[class.lg]': "size() === 'lg'",
    '[attr.aria-label]': 'label()',
    '[attr.title]': 'label()',
  },
  template: `
    @for (segment of segments(); track segment.key) {
      @if (segment.count > 0) {
        <i [class]="segment.key" [style.flex-grow]="segment.percent"></i>
      }
    }
  `,
  styles: `
    :host {
      width: 100%;
      height: 6px;
      display: flex;
      gap: 2px;
      overflow: hidden;
      border-radius: var(--tk-radius-full);
    }
    :host(.lg) {
      height: 8px;
    }
    i {
      display: block;
      min-width: 3px;
      flex-basis: 0;
    }
    .passed {
      background: var(--tk-run-passed);
    }
    .failed {
      background: var(--tk-run-failed);
    }
    .skipped {
      background: var(--tk-run-skipped);
    }
    .waiting {
      background: var(--tk-bg-muted);
    }
  `,
})
export class SessionProgressComponent {
  readonly summary = input.required<RegressionSummary>();
  readonly size = input<'sm' | 'lg'>('sm');

  protected readonly segments = computed(() => progressSegments(this.summary()));
  protected readonly label = computed(() => {
    const s = this.summary();
    return `${s.passed} passed, ${s.failed} failed, ${s.skipped} skipped, ${s.waiting} waiting of ${s.total}`;
  });
}
