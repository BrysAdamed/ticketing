import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { IconComponent } from '@shared/ui/icon/icon.component';
import type { TourSession } from './tour-session';

/// The "Continue the walkthrough" pill of a paused walkthrough (spec 14.4, mockup "Walkthrough
/// paused"): non-modal, at the bottom of the page, never steals focus. Esc inside it or × ends the
/// walkthrough.
@Component({
  selector: 'tk-tour-pill',
  imports: [MatButtonModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let s = session();
    <div
      class="pill"
      role="status"
      data-testid="tour-pill"
      (keydown.escape)="$event.preventDefault(); s.close('dismissed')"
    >
      <span class="icon" aria-hidden="true"><tk-icon name="tablerRoute" [size]="14" /></span>
      <span class="text">
        <b>{{ s.tour.title }}</b>
        <span class="tnum" data-testid="tour-pill-step"
          >Paused at {{ s.label().toLowerCase() }} · {{ s.title() }}</span
        >
      </span>
      <span class="sep" aria-hidden="true"></span>
      <button mat-flat-button type="button" data-testid="tour-pill-continue" (click)="s.resume()">
        Continue the walkthrough
      </button>
      <button
        type="button"
        class="tk-icon-btn tk-icon-btn-sm"
        aria-label="End walkthrough"
        data-testid="tour-pill-close"
        (click)="s.close('dismissed')"
      >
        <tk-icon name="tablerX" [size]="14" />
      </button>
    </div>
  `,
  styles: `
    .pill {
      display: flex;
      align-items: center;
      gap: 10px;
      height: 44px;
      max-width: calc(100vw - 32px);
      padding: 0 var(--tk-space-1-5) 0 var(--tk-space-2);
      background: var(--tk-surface-raised);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-full);
      box-shadow: var(--tk-shadow-lg);
      color: var(--tk-text);
      white-space: nowrap;
      animation: tk-pill-enter var(--tk-duration-fast) var(--tk-ease-out);
    }
    .icon {
      display: grid;
      place-items: center;
      flex: none;
      width: 28px;
      height: 28px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-accent-subtle);
      color: var(--tk-accent-fg);
    }
    .text {
      display: flex;
      flex-direction: column;
      min-width: 0;
      line-height: var(--tk-leading-sm);

      b {
        font-weight: var(--tk-weight-semibold);
        font-size: var(--tk-text-base);
      }
      span {
        overflow: hidden;
        text-overflow: ellipsis;
        color: var(--tk-text-subtle);
        font-size: var(--tk-text-sm);
      }
    }
    .sep {
      flex: none;
      width: 1px;
      height: 20px;
      margin: 0 2px;
      background: var(--tk-border);
    }
    @keyframes tk-pill-enter {
      from {
        opacity: 0;
        transform: translateY(8px);
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .pill {
        animation: none;
      }
    }
  `,
})
export class TourPillComponent {
  readonly session = input.required<TourSession>();
}
