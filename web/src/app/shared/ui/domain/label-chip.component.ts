import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { paletteIndex } from '@shared/util/hash';

/// Label pill with a stable color dot (FNV-1a of the lower-cased label, mod 8).
@Component({
  selector: 'tk-label-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.--tk-chip-color]': 'color()' },
  template: `{{ label() }}`,
  styles: `
    :host {
      height: 20px;
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 0 7px 0 6px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-full);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      color: var(--tk-text-muted);
      white-space: nowrap;
      flex: none;
    }
    :host::before {
      content: '';
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: var(--tk-chip-color);
    }
  `,
})
export class LabelChipComponent {
  readonly label = input.required<string>();
  protected readonly color = computed(() => `var(--tk-palette-${paletteIndex(this.label())})`);
}
