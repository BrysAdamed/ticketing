import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { provideIcons } from '@ng-icons/core';
import { tablerArrowsMinimize, tablerMinus, tablerPlus } from '@ng-icons/tabler-icons';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { fitScale, nextZoom, ZOOM_MAX, ZOOM_MIN } from './diagram-zoom';

/// A diagram that has been rendered: the element and its natural size in CSS pixels.
export interface ViewportContent {
  readonly element: Element;
  readonly width: number;
  readonly height: number;
}

const PADDING = 16;
const MIN_HEIGHT = 120;

/// Shows a rendered diagram fitted to the available width (never enlarged), with zoom (buttons,
/// Ctrl/⌘ + wheel around the pointer) and drag to pan. Its height is the fitted diagram's, at most
/// `maxHeight`; with `fill` it takes its parent's height instead (editor preview). The parent
/// view binds keyboard shortcuts to `zoomIn`, `zoomOut`, `fit` and `actualSize`.
@Component({
  selector: 'tk-diagram-viewport',
  imports: [IconComponent, MatTooltip],
  viewProviders: [provideIcons({ tablerArrowsMinimize, tablerMinus, tablerPlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.fill]': 'fill()',
    '[class.stale]': 'stale()',
    '[style.height.px]': 'fill() ? null : height()',
    'data-testid': 'diagram-viewport',
  },
  template: `
    <div
      #scroller
      class="scroller"
      [class.pannable]="pannable()"
      [class.panning]="panning()"
      (wheel)="onWheel($event)"
      (pointerdown)="startPan($event)"
      (pointermove)="pan($event)"
      (pointerup)="endPan($event)"
      (pointercancel)="endPan($event)"
    >
      <div #stage class="stage" data-testid="diagram-stage"></div>
    </div>
    <div class="zoom" role="toolbar" aria-label="Zoom">
      <button
        type="button"
        class="tk-icon-btn"
        aria-label="Zoom out"
        matTooltip="Zoom out (-)"
        data-testid="diagram-zoom-out"
        [disabled]="scale() <= zoomMin"
        (click)="zoomOut()"
      >
        <tk-icon name="tablerMinus" [size]="14" />
      </button>
      <button
        type="button"
        class="pct tnum"
        aria-label="Actual size"
        matTooltip="Actual size (1)"
        data-testid="diagram-zoom-level"
        (click)="actualSize()"
      >
        {{ percent() }}%
      </button>
      <button
        type="button"
        class="tk-icon-btn"
        aria-label="Zoom in"
        matTooltip="Zoom in (=)"
        data-testid="diagram-zoom-in"
        [disabled]="scale() >= zoomMax"
        (click)="zoomIn()"
      >
        <tk-icon name="tablerPlus" [size]="14" />
      </button>
      <button
        type="button"
        class="tk-icon-btn"
        aria-label="Fit"
        matTooltip="Fit (0)"
        data-testid="diagram-zoom-fit"
        [class.on]="fitted()"
        (click)="fit()"
      >
        <tk-icon name="tablerArrowsMinimize" [size]="14" />
      </button>
    </div>
  `,
  styles: `
    :host {
      position: relative;
      display: block;
      min-height: ${MIN_HEIGHT}px;
    }
    :host(.fill) {
      height: 100%;
    }
    :host(.stale) .stage {
      opacity: 0.55;
    }
    .scroller {
      position: absolute;
      inset: 0;
      display: flex;
      overflow: auto;
      overscroll-behavior: contain;
    }
    .scroller.pannable {
      cursor: grab;
    }
    .scroller.panning {
      cursor: grabbing;
      user-select: none;
    }
    .stage {
      flex: none;
      margin: auto;
      padding: ${PADDING}px;
      line-height: 0;
    }
    .stage > ::ng-deep svg,
    .stage > ::ng-deep img {
      display: block;
      max-width: none;
    }
    .zoom {
      position: absolute;
      right: 8px;
      bottom: 8px;
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface-raised);
      box-shadow: var(--tk-shadow-xs);
      opacity: 0.4;
      transition: opacity 120ms;
    }
    :host(:hover) .zoom,
    .zoom:focus-within {
      opacity: 1;
    }
    .zoom .tk-icon-btn {
      width: 24px;
      height: 24px;
    }
    .zoom .tk-icon-btn.on {
      color: var(--tk-accent-fg);
    }
    .pct {
      min-width: 44px;
      height: 24px;
      padding: 0 4px;
      border: 0;
      border-radius: var(--tk-radius-sm);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-xs);
      cursor: pointer;
    }
    .pct:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
  `,
})
export class DiagramViewportComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');
  private readonly stage = viewChild.required<ElementRef<HTMLElement>>('stage');

  readonly content = input.required<ViewportContent>();
  /// Tallest the viewport grows to (px); default 70% of the window.
  readonly maxHeight = input<number | null>(null);
  readonly fill = input(false);
  /// Dims the diagram (an older render shown while the source has an error).
  readonly stale = input(false);

  protected readonly zoomMin = ZOOM_MIN;
  protected readonly zoomMax = ZOOM_MAX;
  readonly scale = signal(1);
  readonly fitted = signal(true);
  protected readonly panning = signal(false);
  private readonly box = signal({ width: 0, height: 0 });
  private panStart: { x: number; y: number; left: number; top: number } | null = null;

  protected readonly percent = computed(() => Math.round(this.scale() * 100));
  private readonly limit = computed(
    () => this.maxHeight() ?? Math.round((globalThis.innerHeight || 800) * 0.7),
  );
  private readonly fitScale = computed(() => {
    const { width, height } = this.content();
    const box = this.box();
    const availableHeight = this.fill() ? box.height : this.limit();
    return fitScale(width, height, box.width - 2 * PADDING, availableHeight - 2 * PADDING);
  });
  /// The viewport's own height (not in `fill` mode): the fitted diagram, between 120 px and the limit.
  protected readonly height = computed(() => {
    const natural = this.content().height * this.fitScale() + 2 * PADDING;
    return Math.round(Math.max(MIN_HEIGHT, Math.min(this.limit(), natural)));
  });
  protected readonly pannable = computed(() => {
    const { width, height } = this.content();
    const box = this.box();
    const scale = this.scale();
    return width * scale + 2 * PADDING > box.width || height * scale + 2 * PADDING > box.height;
  });

  constructor() {
    const resize = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      this.box.set({ width, height });
    });
    resize.observe(this.host);
    inject(DestroyRef).onDestroy(() => resize.disconnect());

    effect(() => {
      const element = this.content().element;
      const stage = this.stage().nativeElement;
      untracked(() => {
        if (stage.firstElementChild !== element) stage.replaceChildren(element);
      });
    });

    effect(() => {
      const scale = this.fitScale();
      if (untracked(this.fitted)) this.scale.set(scale);
    });

    effect(() => applySize(this.content(), this.scale()));
  }

  zoomIn(): void {
    this.zoomTo(nextZoom(this.scale(), 1));
  }

  zoomOut(): void {
    this.zoomTo(nextZoom(this.scale(), -1));
  }

  fit(): void {
    this.fitted.set(true);
    this.scale.set(this.fitScale());
  }

  actualSize(): void {
    this.zoomTo(1);
  }

  protected onWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    const factor = Math.exp(-event.deltaY * 0.002);
    this.zoomTo(this.scale() * factor, { x: event.clientX, y: event.clientY });
  }

  protected startPan(event: PointerEvent): void {
    if (event.button !== 0 || !this.pannable()) return;
    const scroller = this.scroller().nativeElement;
    this.panStart = {
      x: event.clientX,
      y: event.clientY,
      left: scroller.scrollLeft,
      top: scroller.scrollTop,
    };
    scroller.setPointerCapture?.(event.pointerId);
    this.panning.set(true);
  }

  protected pan(event: PointerEvent): void {
    const start = this.panStart;
    if (!start) return;
    const scroller = this.scroller().nativeElement;
    scroller.scrollLeft = start.left - (event.clientX - start.x);
    scroller.scrollTop = start.top - (event.clientY - start.y);
  }

  protected endPan(event: PointerEvent): void {
    if (!this.panStart) return;
    this.panStart = null;
    this.panning.set(false);
    this.scroller().nativeElement.releasePointerCapture?.(event.pointerId);
  }

  /// Zooms to `scale`, keeping the diagram point under `anchor` (client coordinates; default the
  /// centre of the viewport) where it is.
  private zoomTo(scale: number, anchor?: { x: number; y: number }): void {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, scale));
    const previous = this.scale();
    if (next === previous) return;
    const scroller = this.scroller().nativeElement;
    const rect = scroller.getBoundingClientRect();
    const x = (anchor?.x ?? rect.left + rect.width / 2) - rect.left;
    const y = (anchor?.y ?? rect.top + rect.height / 2) - rect.top;
    const contentX = scroller.scrollLeft + x;
    const contentY = scroller.scrollTop + y;
    this.fitted.set(false);
    this.scale.set(next);
    applySize(this.content(), next);
    const ratio = next / previous;
    scroller.scrollLeft = contentX * ratio - x;
    scroller.scrollTop = contentY * ratio - y;
  }
}

function applySize({ element, width, height }: ViewportContent, scale: number): void {
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  if (element instanceof HTMLElement) {
    element.style.width = `${w}px`;
    element.style.height = `${h}px`;
  } else {
    element.setAttribute('width', String(w));
    element.setAttribute('height', String(h));
  }
}
