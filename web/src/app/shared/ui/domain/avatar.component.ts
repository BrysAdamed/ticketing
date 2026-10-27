import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { paletteIndex } from '@shared/util/hash';
import { initialsOf } from '@shared/util/initials';
import { IconComponent } from '../icon/icon.component';

export type AvatarSize = 20 | 24 | 32;

/// User avatar: initials on a stable palette tint (hash of user id). No user = "Unassigned".
@Component({
  selector: 'tk-avatar',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'name() ?? "Unassigned"',
    '[attr.title]': 'showTitle() ? (name() ?? "Unassigned") : null',
    '[class.none]': '!name()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'fontSize()',
    '[style.--tk-avatar-bg]': '"var(--tk-palette-" + palette() + ")"',
    '[style.--tk-avatar-fg]': '"var(--tk-palette-" + palette() + "-fg)"',
  },
  template: `
    @if (name()) {
      {{ initials() }}
    } @else {
      <tk-icon name="tablerUser" [size]="12" />
    }
  `,
  styles: `
    :host {
      border-radius: 50%;
      display: inline-grid;
      place-items: center;
      flex: none;
      font-weight: var(--tk-weight-semibold);
      letter-spacing: 0.01em;
      line-height: 1;
      background: color-mix(in srgb, var(--tk-avatar-bg) var(--tk-tint-avatar), transparent);
      color: var(--tk-avatar-fg);
      user-select: none;
    }
    :host(.none) {
      border: 1px dashed var(--tk-border-strong);
      color: var(--tk-text-subtle);
      background: transparent;
    }
  `,
})
export class AvatarComponent {
  readonly userId = input<string | null | undefined>(null);
  readonly name = input<string | null | undefined>(null);
  readonly size = input<AvatarSize>(20);
  readonly showTitle = input(true);

  protected readonly initials = computed(() => initialsOf(this.name() ?? ''));
  protected readonly fontSize = computed(() => ({ 20: 9, 24: 10, 32: 12 })[this.size()]);
  protected readonly palette = computed(() => paletteIndex(this.userId() ?? this.name() ?? ''));
}
