import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  inject,
  input,
  signal,
} from '@angular/core';

const SHOW_AFTER_MS = 120;

/// Row-shaped loading placeholder (layout-and-screens §2): status circle, key bar, title bar of
/// seeded random width and an avatar circle. Appears only after 120ms so fast loads never flash.
@Component({
  selector: 'tk-skeleton-rows',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'status', 'aria-label': 'Loading', 'data-testid': 'skeleton' },
  template: `
    @if (visible()) {
      @for (row of rows(); track $index) {
        <div class="row">
          <span class="bone circle"></span>
          <span class="bone key"></span>
          <span class="bone title" [style.width.%]="row"></span>
          <span class="fill"></span>
          <span class="bone circle avatar"></span>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .row {
      height: var(--tk-row-h);
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 0 20px 0 14px;
      border-bottom: 1px solid var(--tk-border-subtle);
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
      flex: none;
    }
    .circle {
      width: 14px;
      height: 14px;
      border-radius: 50%;
    }
    .avatar {
      width: 20px;
      height: 20px;
    }
    .key {
      width: 48px;
    }
    .fill {
      flex: 1;
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
export class SkeletonRowsComponent {
  readonly count = input(8);
  readonly seed = input(7);
  readonly delayMs = input(SHOW_AFTER_MS);

  protected readonly visible = signal(false);
  protected readonly rows = computed(() => {
    let state = this.seed() * 9301 + 49297;
    return Array.from({ length: this.count() }, () => {
      state = (state * 9301 + 49297) % 233280;
      return 40 + Math.round((state / 233280) * 30);
    });
  });

  constructor() {
    const timer = setTimeout(() => this.visible.set(true), this.delayMs());
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
  }
}
