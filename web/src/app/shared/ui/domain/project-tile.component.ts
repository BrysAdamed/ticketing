import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { paletteIndex } from '@shared/util/hash';

/// 16px colored tile with the project's first letter, color stable per project key.
@Component({
  selector: 'tk-project-tile',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'aria-hidden': 'true',
    '[style.--tk-tile-bg]': '"var(--tk-palette-" + palette() + ")"',
    '[style.--tk-tile-fg]': '"var(--tk-palette-" + palette() + "-fg)"',
  },
  template: `{{ projectKey().charAt(0) }}`,
  styles: `
    :host {
      width: 16px;
      height: 16px;
      border-radius: var(--tk-radius-sm);
      display: inline-grid;
      place-items: center;
      flex: none;
      font-size: 9px;
      font-weight: 700;
      line-height: 1;
      background: color-mix(in srgb, var(--tk-tile-bg) var(--tk-tint-avatar), transparent);
      color: var(--tk-tile-fg);
    }
  `,
})
export class ProjectTileComponent {
  readonly projectKey = input.required<string>();
  protected readonly palette = computed(() => paletteIndex(this.projectKey()));
}
