import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ThemeService } from '@core/theme/theme.service';
import { DiagramSource } from '../diagram-renderers';
import { DiagramViewportComponent, ViewportContent } from '../diagram-viewport.component';
import { renderCanvas } from './canvas-renderer';

type PictureState =
  | { kind: 'loading' }
  | { kind: 'ready'; content: ViewportContent }
  | { kind: 'notice'; text: string };

/// One Canvas version as its picture in a zoomable viewport, without the diagram view's chrome:
/// the side-by-side history comparison and the drawings conflict view.
@Component({
  selector: 'tk-canvas-picture',
  imports: [DiagramViewportComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.fill]': 'fill()', '[attr.data-state]': 'state().kind' },
  template: `
    @let shown = state();
    @switch (shown.kind) {
      @case ('ready') {
        @if (shown.kind === 'ready') {
          <tk-diagram-viewport [content]="shown.content" [fill]="fill()" [maxHeight]="480" />
        }
      }
      @case ('notice') {
        @if (shown.kind === 'notice') {
          <p class="notice">{{ shown.text }}</p>
        }
      }
      @default {
        <div class="sk" role="status" aria-label="Drawing the diagram"></div>
      }
    }
  `,
  styles: `
    :host {
      display: block;
    }
    :host(.fill) {
      height: 100%;
    }
    .notice {
      margin: 0;
      padding: 24px 16px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      text-align: center;
    }
    .sk {
      height: 100%;
      min-height: 160px;
      background: linear-gradient(
        90deg,
        var(--tk-skeleton) 0%,
        var(--tk-skeleton-shine) 50%,
        var(--tk-skeleton) 100%
      );
      background-size: 200% 100%;
      animation: tk-diagram-shimmer 1.4s linear infinite;
      opacity: 0.6;

      @media (prefers-reduced-motion: reduce) {
        animation: none;
      }
    }
  `,
})
export class CanvasPictureComponent {
  private readonly theme = inject(ThemeService).theme;

  readonly source = input.required<DiagramSource>();
  readonly fill = input(false);

  protected readonly state = signal<PictureState>({ kind: 'loading' });
  private generation = 0;

  constructor() {
    effect(() => {
      const source = this.source();
      const theme = this.theme();
      untracked(() => void this.render(source, theme));
    });
  }

  private async render(source: DiagramSource, theme: 'light' | 'dark'): Promise<void> {
    const generation = ++this.generation;
    const rendered = await renderCanvas(source, theme);
    if (generation !== this.generation) return;
    this.state.set(
      'error' in rendered
        ? { kind: 'notice', text: rendered.error }
        : { kind: 'ready', content: rendered },
    );
  }
}
