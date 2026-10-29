import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { TourSession } from './tour-session';

let nextMaskId = 0;

const FAR = 100000;

/// Dims the page except for a rounded hole around the current anchor (an SVG mask), with an
/// accent ring. On a modal step pointer events pass through to the CDK backdrop underneath, which
/// blocks the page. An action-driven step has no backdrop: a transparent even-odd path swallows
/// clicks on the dimmed area (they focus the card) and lets them through the hole. Hidden while the
/// user's own dialog, picker or peek covers an action-driven step.
@Component({
  selector: 'tk-tour-spotlight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    'data-testid': 'tour-spotlight',
    '[class.hidden]': 'session().hidden()',
  },
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
      @if (blocker(); as d) {
        <path
          class="blocker"
          data-testid="tour-spotlight-blocker"
          fill="transparent"
          fill-rule="evenodd"
          [attr.d]="d"
          (click)="session().focusCard()"
        />
      }
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
    :host(.hidden) {
      display: none;
    }
    svg {
      display: block;
    }
    .dim {
      fill: var(--tk-overlay-mask);
    }
    .blocker {
      pointer-events: all;
    }
    .ring {
      fill: none;
      stroke: var(--tk-accent);
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
  protected readonly blocker = computed(() => {
    const session = this.session();
    const h = this.hole();
    if (session.modal() || !h) return null;
    const outer = `M${-FAR} ${-FAR}H${FAR}V${FAR}H${-FAR}Z`;
    return `${outer} M${h.x} ${h.y}h${h.width}v${h.height}h${-h.width}Z`;
  });
}
