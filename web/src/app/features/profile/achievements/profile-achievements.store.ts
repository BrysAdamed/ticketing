import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { ACHIEVEMENTS_DISABLED, MyAchievement } from '@core/achievements/achievement.models';
import { AchievementsAccess } from '@core/achievements/achievements-access';
import { AchievementsApi } from '@core/achievements/achievements.api';
import { ToastService } from '@core/notify/toast.service';
import { groupAchievements, unseenIds, withShared } from './achievements.logic';

export type AchievementsStatus = 'loading' | 'loaded' | 'error' | 'disabled';

@Injectable()
export class ProfileAchievementsStore {
  private readonly api = inject(AchievementsApi);
  private readonly access = inject(AchievementsAccess);
  private readonly toast = inject(ToastService);

  readonly status = signal<AchievementsStatus>('loading');
  readonly items = signal<readonly MyAchievement[]>([]);
  readonly groups = computed(() => groupAchievements(this.items()));
  readonly nothingEarned = computed(
    () => this.status() === 'loaded' && this.groups().earned.length === 0,
  );
  /// Ids whose share or unshare is on its way; a second toggle waits for the first.
  readonly sharing = signal<ReadonlySet<string>>(new Set());

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

  /// Shares or unshares an earned achievement: the medal changes at once, the server's item
  /// replaces it, and a failure puts it back with a danger toast. Success offers Undo.
  async setShared(id: string, shared: boolean): Promise<void> {
    const item = this.items().find((i) => i.id === id);
    if (!item || item.tier <= 0 || item.shared === shared || this.sharing().has(id)) return;
    this.items.update((items) => withShared(items, id, shared));
    this.setPending(id, true);
    try {
      const updated = await firstValueFrom(shared ? this.api.share(id) : this.api.unshare(id));
      this.items.update((items) => items.map((i) => (i.id === id ? updated : i)));
      this.toast.success(shared ? `${item.name} is shared` : `${item.name} is no longer shared`, {
        action: { label: 'Undo', run: () => void this.setShared(id, !shared) },
      });
    } catch (error) {
      this.items.update((items) => withShared(items, id, !shared));
      const apiError = toApiError(error);
      if (apiError.isNotFound && apiError.code === ACHIEVEMENTS_DISABLED) {
        this.access.markDisabled();
        this.status.set('disabled');
        return;
      }
      this.toast.error(
        shared ? `Couldn't share ${item.name}` : `Couldn't stop sharing ${item.name}`,
        { action: { label: 'Retry', run: () => void this.setShared(id, shared) } },
      );
    } finally {
      this.setPending(id, false);
    }
  }

  private setPending(id: string, pending: boolean): void {
    this.sharing.update((ids) => {
      const next = new Set(ids);
      if (pending) next.add(id);
      else next.delete(id);
      return next;
    });
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
