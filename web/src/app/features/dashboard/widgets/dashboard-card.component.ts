import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type SkeletonShape = 'bars' | 'rows' | 'chart' | 'figure';

/// Card frame for one dashboard widget (layout-and-screens §3.5): 40px header with the title,
/// an optional muted note and header actions, then the body. With `loading` the body becomes a
/// skeleton that mirrors the widget's anatomy.
@Component({
  selector: 'tk-dashboard-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'region', '[attr.aria-label]': 'title()', '[attr.aria-busy]': 'loading()' },
  template: `
    <header>
      <h2>{{ title() }}</h2>
      @if (note()) {
        <span class="note">{{ note() }}</span>
      }
      <span class="actions"><ng-content select="[cardActions]" /></span>
    </header>
    @if (loading()) {
      <div [class]="'skeleton ' + shape()" aria-hidden="true">
        @for (width of widths(); track $index) {
          <span class="bone" [style.width.%]="width"></span>
        }
      </div>
    } @else {
      <div class="body"><ng-content /></div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-width: 0;
      background: var(--tk-surface);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
    }
    header {
      height: 40px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px 0 16px;
      flex: none;
    }
    h2 {
      margin: 0;
      font-size: var(--tk-text-base);
      line-height: var(--tk-leading-base);
      font-weight: var(--tk-weight-semibold);
      white-space: nowrap;
    }
    .note {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .actions {
      margin-left: auto;
      display: inline-flex;
      align-items: center;
      gap: 4px;
    }
    .body {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-height: 0;
      padding: 4px 16px 16px;
    }
    .skeleton {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 8px 16px 16px;
    }
    .skeleton.chart {
      min-height: 220px;
    }
    .skeleton.chart .bone {
      flex: 1;
      height: auto;
      border-radius: var(--tk-radius-md);
    }
    .skeleton.figure .bone:first-child {
      height: 28px;
    }
    .bone {
      height: 10px;
      border-radius: var(--tk-radius-sm);
      background: linear-gradient(
        90deg,
        var(--tk-skeleton) 0%,
        var(--tk-skeleton-shine) 50%,
        var(--tk-skeleton) 100%
      );
      background-size: 200% 100%;
      animation: shimmer 1.4s linear infinite;
    }
    @keyframes shimmer {
      from {
        background-position: 200% 0;
      }
      to {
        background-position: -200% 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .bone {
        animation: none;
      }
    }
  `,
})
export class DashboardCardComponent {
  readonly title = input.required<string>();
  readonly note = input<string | null>(null);
  readonly loading = input(false);
  readonly shape = input<SkeletonShape>('bars');
  readonly lines = input(5);

  protected readonly widths = computed(() => {
    if (this.shape() === 'chart') return [100];
    let state = this.title().length * 7919;
    return Array.from({ length: this.lines() }, () => {
      state = (state * 9301 + 49297) % 233280;
      return 45 + Math.round((state / 233280) * 50);
    });
  });
}
