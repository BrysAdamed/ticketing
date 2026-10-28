import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TourSession } from './tour-session';

let nextMaskId = 0;

/// Dims the page except for a rounded hole around the current anchor (an SVG mask), with an
/// accent ring. Pointer events pass through to the CDK backdrop underneath, which blocks the page.
@Component({
  selector: 'tk-tour-spotlight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true', 'data-testid': 'tour-spotlight' },
  template: `
    <svg width="100%" height="100%">
      <defs>
        <mask [attr.id]="maskId">
          <rect width="100%" height="100%" fill="white" />
          @if (hole(); as h) {
            <rect
              class="cut"
              [attr.x]="h.x"
              [attr.y]="h.y"
              [attr.width]="h.width"
              [attr.height]="h.height"
              rx="8"
              fill="black"
            />
          }
        </mask>
      </defs>
      <rect class="dim" width="100%" height="100%" [attr.mask]="'url(#' + maskId + ')'" />
      @if (hole(); as h) {
        <rect
          class="ring"
          data-testid="tour-spotlight-hole"
          [attr.x]="h.x"
          [attr.y]="h.y"
          [attr.width]="h.width"
          [attr.height]="h.height"
          rx="8"
        />
      }
    </svg>
  `,
  styles: `
    :host {
      position: fixed;
      inset: 0;
      pointer-events: none;
      animation: tk-tour-fade var(--tk-duration-base) var(--tk-ease-out);
    }
    svg {
      display: block;
    }
    .dim {
      fill: var(--tk-overlay-mask);
    }
    .ring {
      fill: none;
      stroke: var(--tk-focus);
      stroke-width: 2;
    }
    .cut,
    .ring {
      transition:
        x var(--tk-duration-base) var(--tk-ease-out),
        y var(--tk-duration-base) var(--tk-ease-out),
        width var(--tk-duration-base) var(--tk-ease-out),
        height var(--tk-duration-base) var(--tk-ease-out);
    }
    @keyframes tk-tour-fade {
      from {
        opacity: 0;
      }
    }
  `,
})
export class TourSpotlightComponent {
  readonly session = input.required<TourSession>();
  protected readonly maskId = `tk-tour-mask-${nextMaskId++}`;
  protected readonly hole = computed(() => this.session().hole());
}
