import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgIcon } from '@ng-icons/core';

export type IconSize = 12 | 14 | 16 | 20 | 32;

/// Single wrapper around the icon set (Tabler via ng-icons) so swapping icon sets touches one
/// file. Icons must be registered with `provideIcons` (app-wide set in `app-icons.generated.ts`, or in a
/// component's `viewProviders`).
@Component({
  selector: 'tk-icon',
  imports: [NgIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'aria-hidden': 'true' },
  template: `<ng-icon [name]="name()" [size]="px()" [strokeWidth]="stroke()" />`,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
      line-height: 0;
    }
  `,
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<IconSize>(16);
  readonly strokeWidth = input<number | undefined>(undefined);

  protected readonly px = computed(() => `${this.size()}px`);
  protected readonly stroke = computed(
    () => this.strokeWidth() ?? (this.size() >= 20 ? 1.5 : 1.75),
  );
}
