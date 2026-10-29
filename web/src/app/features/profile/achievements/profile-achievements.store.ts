import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { ACHIEVEMENTS_DISABLED, MyAchievement } from '@core/achievements/achievement.models';
import { AchievementsAccess } from '@core/achievements/achievements-access';
import { AchievementsApi } from '@core/achievements/achievements.api';
import { groupAchievements, unseenIds } from './achievements.logic';

export type AchievementsStatus = 'loading' | 'loaded' | 'error' | 'disabled';

@Injectable()
export class ProfileAchievementsStore {
  private readonly api = inject(AchievementsApi);
  private readonly access = inject(AchievementsAccess);

  readonly status = signal<AchievementsStatus>('loading');
  readonly items = signal<readonly MyAchievement[]>([]);
  readonly groups = computed(() => groupAchievements(this.items()));
  readonly nothingEarned = computed(
    () => this.status() === 'loaded' && this.groups().earned.length === 0,
  );

  /// Loads the catalogue, then marks every unseen earned tier seen (opening the tab is seeing
  /// them). `achievements.disabled` hides the tab for this session.
  async load(): Promise<void> {
    this.status.set('loading');
    try {
      const result = await firstValueFrom(this.api.list());
      this.items.set(result.items);
      this.status.set('loaded');
      this.access.markEnabled();
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.isNotFound && apiError.code === ACHIEVEMENTS_DISABLED) {
        this.access.markDisabled();
        this.status.set('disabled');
      } else {
        this.status.set('error');
      }
      return;
    }
    await this.markSeen();
  }

  private async markSeen(): Promise<void> {
    const ids = unseenIds(this.items());
    if (ids.length === 0) return;
    try {
      await firstValueFrom(this.api.markSeen(ids));
    } catch {
      return;
    }
    const seenAt = new Date().toISOString();
    const marked = new Set(ids);
    this.items.update((items) =>
      items.map((item) =>
        item.id && marked.has(item.id)
          ? {
              ...item,
              tiers: item.tiers.map((t) => (t.unlockedAt && !t.seenAt ? { ...t, seenAt } : t)),
            }
          : item,
      ),
    );
  }
}
