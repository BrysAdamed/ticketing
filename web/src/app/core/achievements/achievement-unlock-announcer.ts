import { DOCUMENT } from '@angular/common';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ToastService } from '../notify/toast.service';
import { AchievementToastComponent, AchievementToastData } from './achievement-toast.component';
import {
  freshUnlocks,
  planUnlockToasts,
  rememberToasted,
  unlockKey,
  UnlockToast,
  UnlockToastItem,
} from './achievement-unlocks.logic';
import { UnseenAchievement } from './achievement.models';
import { AchievementsApi } from './achievements.api';
import { ToastedTiers } from './toasted-tiers';

export const ACHIEVEMENTS_URL = '/profile/achievements';
export const UNLOCK_TOAST_MS = 5_000;

interface CatalogueEntry {
  tierCount: number;
  description: string | null;
}

/// Toasts newly unseen achievement tiers once per tier per browser (spec 15.10, D-152). Loaded by
/// `AchievementUnlocks` on the first unseen tier, so the toast and its medal glyphs stay out of
/// the initial bundle.
@Injectable({ providedIn: 'root' })
export class AchievementUnlockAnnouncer {
  private readonly api = inject(AchievementsApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  private readonly toasted = new ToastedTiers(inject(DOCUMENT));
  private readonly toastedInSession = new Set<string>();
  private readonly queue: UnlockToast[] = [];
  private catalogue: Map<string, CatalogueEntry> | null = null;
  private showing = false;

  /// Toasts the tiers among `unseen` not toasted before and remembers them, keeping only tiers
  /// that are still unseen.
  async announce(userId: string, unseen: readonly UnseenAchievement[]): Promise<void> {
    const stored = this.toasted.read(userId);
    const fresh = freshUnlocks(unseen, new Set([...stored, ...this.toastedInSession]));
    this.toasted.write(userId, rememberToasted(stored, fresh, unseen));
    if (fresh.length === 0) return;
    for (const item of fresh) this.toastedInSession.add(unlockKey(item));

    const catalogue = await this.loadCatalogue(fresh.map((item) => item.id));
    const items: UnlockToastItem[] = fresh.map((item) => ({
      ...item,
      tierCount: catalogue.get(item.id)?.tierCount ?? 4,
      description: catalogue.get(item.id)?.description ?? null,
    }));
    this.queue.push(...planUnlockToasts(items));
    this.showNext();
  }

  /// Signed out or achievements turned off: drop what is queued and what this session knows.
  reset(): void {
    this.toastedInSession.clear();
    this.queue.length = 0;
    this.catalogue = null;
  }

  private showNext(): void {
    if (this.showing) return;
    const next = this.queue.shift();
    if (!next) return;
    this.showing = true;
    const data: AchievementToastData = {
      toast: next,
      durationMs: UNLOCK_TOAST_MS,
      view: () => void this.router.navigateByUrl(ACHIEVEMENTS_URL),
    };
    this.toast
      .showComponent(AchievementToastComponent, data)
      .afterDismissed()
      .subscribe(() => {
        this.showing = false;
        this.showNext();
      });
  }

  /// Descriptions and tier counts for the toast's text and medal, read only when there is
  /// something to toast and again only for an id the cached copy lacks (a secret masked at the
  /// last read). Without it the toast still shows, with a neutral line.
  private async loadCatalogue(ids: readonly string[]): Promise<Map<string, CatalogueEntry>> {
    const cached = this.catalogue;
    if (cached && ids.every((id) => cached.has(id))) return cached;
    try {
      const { items } = await firstValueFrom(this.api.list());
      this.catalogue = new Map(
        items
          .filter((item) => item.id !== null)
          .map((item) => [
            item.id as string,
            { tierCount: item.tiers.length, description: item.description },
          ]),
      );
      return this.catalogue;
    } catch {
      return cached ?? new Map();
    }
  }
}
