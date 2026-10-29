import { ConnectedPosition, CdkConnectedOverlay } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { provideIcons } from '@ng-icons/core';
import { tablerShare } from '@ng-icons/tabler-icons';
import { Router } from '@angular/router';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { tierColor } from '@shared/ui/achievement-medal/achievement-medal.logic';
import { AchievementMedalComponent } from '@shared/ui/achievement-medal/achievement-medal.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AchievementDetailComponent } from './achievement-detail.component';
import { AchievementTile, gridMove } from './achievements.logic';
import { ProfileAchievementsStore } from './profile-achievements.store';

const SKELETON_AFTER_MS = 120;

interface TileGroup {
  id: 'earned' | 'to-earn' | 'secret';
  title: string;
  label: string;
  tiles: AchievementTile[];
}

interface OpenDetail {
  tile: AchievementTile;
  origin: HTMLElement;
}

@Component({
  selector: 'tk-profile-achievements-view',
  imports: [
    CdkConnectedOverlay,
    MatButtonModule,
    AchievementMedalComponent,
    AchievementDetailComponent,
    EmptyStateComponent,
    IconComponent,
  ],
  providers: [ProfileAchievementsStore],
  viewProviders: [provideIcons({ tablerShare })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-profile.achievements' },
  templateUrl: './profile-achievements.view.html',
  styleUrl: './profile-achievements.view.scss',
})
export class ProfileAchievementsView {
  protected readonly store = inject(ProfileAchievementsStore);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly skeletonVisible = signal(false);
  protected readonly skeletons = [0, 1, 2, 3, 4, 5];
  protected readonly groups = computed<TileGroup[]>(() => {
    const { earned, toEarn, secret } = this.store.groups();
    return [
      { id: 'earned' as const, title: 'Earned', label: 'Earned achievements', tiles: earned },
      {
        id: 'to-earn' as const,
        title: 'Still to earn',
        label: 'Achievements still to earn',
        tiles: toEarn,
      },
      { id: 'secret' as const, title: 'Secret', label: 'Secret achievements', tiles: secret },
    ].filter((g) => g.tiles.length > 0);
  });
  private readonly order = computed(
    () =>
      new Map(
        this.groups()
          .flatMap((g) => g.tiles)
          .map((t, i) => [t.key, i] as const),
      ),
  );
  private readonly focusIndex = signal(0);
  protected readonly tabStop = computed(() =>
    Math.min(this.focusIndex(), Math.max(this.order().size - 1, 0)),
  );
  protected readonly detail = signal<OpenDetail | null>(null);
  protected readonly detailTile = computed(() => {
    const open = this.detail();
    if (!open) return null;
    return (
      this.groups()
        .flatMap((g) => g.tiles)
        .find((t) => t.key === open.tile.key) ?? open.tile
    );
  });
  protected readonly overlayOrigin = computed(
    () => this.detail()?.origin ?? this.host.nativeElement,
  );
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top', offsetY: 6 },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom', offsetY: -6 },
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];

  constructor() {
    const timer = setTimeout(() => this.skeletonVisible.set(true), SKELETON_AFTER_MS);
    inject(DestroyRef).onDestroy(() => clearTimeout(timer));
    void this.store.load();
    const router = inject(Router);
    effect(() => {
      if (this.store.status() === 'disabled')
        void router.navigate(['/profile'], { replaceUrl: true });
    });
    inject(ShortcutService).registerScoped([
      {
        keys: 's',
        section: 'Achievements',
        description: 'Share or unshare the focused achievement',
        handler: () => this.toggleFocusedShare(),
      },
    ]);
  }

  protected toggleShare(tile: AchievementTile): void {
    const id = tile.item.id;
    if (id && tile.item.tier > 0) void this.store.setShared(id, !tile.item.shared);
  }

  private toggleFocusedShare(): void {
    const root = this.host.nativeElement;
    const buttons = Array.from(root.querySelectorAll<HTMLElement>('[data-achievement-open]'));
    const index = buttons.indexOf(root.ownerDocument.activeElement as HTMLElement);
    const tile = index < 0 ? undefined : this.groups().flatMap((g) => g.tiles)[index];
    if (tile) this.toggleShare(tile);
  }

  protected indexOf(tile: AchievementTile): number {
    return this.order().get(tile.key) ?? -1;
  }

  protected barColor(tile: AchievementTile): string | null {
    const next = tile.progress?.nextTier;
    return next ? tierColor(next) : null;
  }

  protected focused(tile: AchievementTile): void {
    this.focusIndex.set(this.indexOf(tile));
  }

  protected open(tile: AchievementTile, origin: EventTarget | null): void {
    this.focused(tile);
    if (origin instanceof HTMLElement) this.detail.set({ tile, origin });
  }

  protected close(): void {
    this.detail.set(null);
  }

  protected onOverlayKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  }

  protected onTileKeydown(event: KeyboardEvent, tile: AchievementTile): void {
    const root = this.host.nativeElement;
    const grid = root.querySelector<HTMLElement>('[data-achievement-grid]');
    const columns = grid ? getComputedStyle(grid).gridTemplateColumns.split(' ').length : 1;
    const next = gridMove(
      event.key,
      this.indexOf(tile),
      this.groups().map((g) => g.tiles.length),
      columns,
    );
    if (next === null) return;
    event.preventDefault();
    this.focusIndex.set(next);
    root.querySelectorAll<HTMLElement>('[data-achievement-open]')[next]?.focus();
  }
}
