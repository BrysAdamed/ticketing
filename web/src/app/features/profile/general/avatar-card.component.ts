import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  inject,
  input,
  signal,
  WritableSignal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AVATAR_COLORS, AVATAR_ICONS, avatarColorIndex } from '@shared/avatars/avatar-catalog';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { paletteIndex } from '@shared/util/hash';
import { initialsOf } from '@shared/util/initials';
import { CurrentUser } from '@core/auth/current-user';
import { ProfileGeneralStore } from './profile-general.store';
import { columnsOf, rovingIndex } from './roving-index';

interface ColorOption {
  key: string | null;
  label: string;
  palette: number;
}

/// Profile → Avatar (TKT-70): an animal icon grid and a colour row, both radio groups with a
/// roving tabindex, a live preview and "Use initials". Every pick saves at once.
@Component({
  selector: 'tk-avatar-card',
  imports: [MatButtonModule, AvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './avatar-card.component.html',
  styleUrl: './avatar-card.component.scss',
})
export class AvatarCardComponent {
  protected readonly store = inject(ProfileGeneralStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly user = input.required<CurrentUser>();

  protected readonly icons = AVATAR_ICONS;
  protected readonly skeletonTiles = AVATAR_ICONS.map((i) => i.key);
  protected readonly current = computed(() => this.store.avatar() ?? { icon: null, color: null });
  protected readonly initials = computed(() => initialsOf(this.user().displayName));
  protected readonly palette = computed(
    () => avatarColorIndex(this.current().color) ?? paletteIndex(this.user().id),
  );
  protected readonly colors = computed<ColorOption[]>(() => [
    { key: null, label: 'Automatic', palette: paletteIndex(this.user().id) },
    ...AVATAR_COLORS.map((c, palette) => ({ key: c.key, label: c.label, palette })),
  ]);
  protected readonly currentImage = computed(() => {
    const icon = this.current().icon;
    return icon ? this.store.imageOf(icon) : null;
  });

  private readonly iconFocus = signal<number | null>(null);
  private readonly colorFocus = signal<number | null>(null);
  protected readonly iconTabStop = computed(
    () =>
      this.iconFocus() ??
      Math.max(
        0,
        AVATAR_ICONS.findIndex((i) => i.key === this.current().icon),
      ),
  );
  protected readonly colorTabStop = computed(
    () =>
      this.colorFocus() ??
      Math.max(
        0,
        this.colors().findIndex((c) => c.key === this.current().color),
      ),
  );

  constructor() {
    this.store.loadAvatarArt();
  }

  protected pickIcon(icon: string): void {
    this.iconFocus.set(null);
    if (icon !== this.current().icon) void this.store.saveAvatar({ ...this.current(), icon });
  }

  protected pickColor(color: string | null): void {
    this.colorFocus.set(null);
    if (color !== this.current().color) void this.store.saveAvatar({ ...this.current(), color });
  }

  protected useInitials(): void {
    void this.store.saveAvatar({ ...this.current(), icon: null });
  }

  protected onIconKeydown(event: KeyboardEvent): void {
    this.move(event, '[data-avatar-tile]', this.iconFocus);
  }

  protected onColorKeydown(event: KeyboardEvent): void {
    this.move(event, '[data-avatar-swatch]', this.colorFocus);
  }

  private move(event: KeyboardEvent, selector: string, focus: WritableSignal<number | null>): void {
    const items = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>(selector));
    const index = items.indexOf(event.target as HTMLElement);
    if (index < 0) return;
    const next = rovingIndex(event.key, index, items.length, columnsOf(items));
    if (next === null) return;
    event.preventDefault();
    focus.set(next);
    items[next].focus();
  }
}
