import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { AVATAR_SOURCE, resolveAvatar } from '@shared/avatars/avatar-source';
import { initialsOf } from '@shared/util/initials';
import { IconComponent } from '../icon/icon.component';

export type AvatarSize = 20 | 24 | 32;

/// User avatar: the animal icon the user chose (`AVATAR_SOURCE`, by user id), else initials; on
/// the chosen palette colour, else a stable tint hashed from the user id. No user = "Unassigned".
@Component({
  selector: 'tk-avatar',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'img',
    '[attr.aria-label]': 'name() ?? "Unassigned"',
    '[attr.title]': 'showTitle() ? (name() ?? "Unassigned") : null',
    '[attr.data-avatar-icon]': 'name() ? avatar().icon : null',
    '[class.none]': '!name()',
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    '[style.font-size.px]': 'fontSize()',
    '[style.--tk-avatar-bg]': '"var(--tk-palette-" + avatar().palette + ")"',
    '[style.--tk-avatar-fg]': '"var(--tk-palette-" + avatar().palette + "-fg)"',
  },
  template: `
    @if (!name()) {
      <tk-icon name="tablerUser" [size]="12" />
    } @else if (avatar().src; as src) {
      <img alt="" [src]="src" [width]="imageSize()" [height]="imageSize()" />
    } @else if (!avatar().pending) {
      {{ initials() }}
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
    img {
      display: block;
    }
  `,
})
export class AvatarComponent {
  private readonly source = inject(AVATAR_SOURCE, { optional: true });

  readonly userId = input<string | null | undefined>(null);
  readonly name = input<string | null | undefined>(null);
  readonly size = input<AvatarSize>(20);
  readonly showTitle = input(true);

  protected readonly initials = computed(() => initialsOf(this.name() ?? ''));
  protected readonly fontSize = computed(() => ({ 20: 9, 24: 10, 32: 12 })[this.size()]);
  protected readonly imageSize = computed(() => ({ 20: 14, 24: 18, 32: 22 })[this.size()]);
  protected readonly avatar = computed(() =>
    resolveAvatar(this.source, this.userId(), this.userId() ?? this.name() ?? ''),
  );
}
