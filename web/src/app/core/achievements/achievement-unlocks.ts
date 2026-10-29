import { DOCUMENT } from '@angular/common';
import { computed, effect, inject, Injectable, Injector, signal, untracked } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../api/api-error';
import { AuthService } from '../auth/auth.service';
import { NotificationCenter } from '../notifications/notification-center';
import type { AchievementUnlockAnnouncer } from './achievement-unlock-announcer';
import { ACHIEVEMENTS_DISABLED, UnseenAchievement, UnseenAchievements } from './achievement.models';
import { AchievementsAccess } from './achievements-access';
import { AchievementsApi } from './achievements.api';
import { ToastedTiers } from './toasted-tiers';

/// The signed-in user's unseen achievement tiers (spec 15.10, D-152): fetched on the notification
/// poll while achievements are on, handed to the lazily loaded announcer for the unlock toasts,
/// and the avatar-menu dot while any are unseen. Opening the Achievements tab marks them seen and
/// reports the rest through `apply`.
@Injectable({ providedIn: 'root' })
export class AchievementUnlocks {
  private readonly api = inject(AchievementsApi);
  private readonly access = inject(AchievementsAccess);
  private readonly auth = inject(AuthService);
  private readonly injector = inject(Injector);
  private readonly toasted = new ToastedTiers(inject(DOCUMENT));

  private readonly count = signal(0);
  private announcer: AchievementUnlockAnnouncer | null = null;
  private generation = 0;

  /// True while the user has earned tiers they have not seen; drives the dot and the "New" badge.
  readonly hasUnseen = computed(() => this.access.enabled() && this.count() > 0);

  constructor() {
    inject(NotificationCenter)
      .polls.pipe(takeUntilDestroyed())
      .subscribe(() => void this.refresh());

    effect(() => {
      const enabled = this.access.enabled();
      untracked(() => {
        this.generation++;
        this.count.set(0);
        if (enabled) void this.refresh();
        else this.announcer?.reset();
      });
    });
  }

  async refresh(): Promise<void> {
    const userId = this.auth.currentUser()?.id;
    if (!userId || !this.access.enabled()) return;
    const generation = ++this.generation;
    let unseen: UnseenAchievements;
    try {
      unseen = await firstValueFrom(this.api.unseen());
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.isNotFound && apiError.code === ACHIEVEMENTS_DISABLED)
        this.access.markDisabled();
      return;
    }
    if (generation !== this.generation || this.auth.currentUser()?.id !== userId) return;
    this.count.set(unseen.count);
    if (unseen.items.length) await this.announce(userId, unseen.items);
    else this.toasted.forget(userId);
  }

  /// What is still unseen after the tab marked tiers seen (`POST /me/achievements/seen`).
  apply(unseen: UnseenAchievements): void {
    this.generation++;
    this.count.set(unseen.count);
    const userId = this.auth.currentUser()?.id;
    if (userId && unseen.count === 0) this.toasted.forget(userId);
  }

  private async announce(userId: string, items: readonly UnseenAchievement[]): Promise<void> {
    if (!this.announcer) {
      const loaded = await import('./achievement-unlock-announcer').catch(() => null);
      if (!loaded) return;
      this.announcer = this.injector.get(loaded.AchievementUnlockAnnouncer);
    }
    if (this.auth.currentUser()?.id === userId && this.access.enabled())
      await this.announcer.announce(userId, items);
  }
}
