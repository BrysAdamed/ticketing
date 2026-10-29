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
import { Router } from '@angular/router';
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
