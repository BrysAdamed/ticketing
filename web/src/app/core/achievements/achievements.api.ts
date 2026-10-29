import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import {
  MyAchievement,
  MyAchievements,
  SharedAchievements,
  UnseenAchievements,
} from './achievement.models';

const BASE = '/me/achievements';

/// The signed-in user's own achievements (`/me/achievements`, spec 15.6). Every call fails with
/// 404 `achievements.disabled` while the flag is off for the user or after they opted out.
@Injectable({ providedIn: 'root' })
export class AchievementsApi {
  private readonly api = inject(ApiClient);

  /// The whole catalogue in catalogue order, with the tiers earned and the live progress.
  list(): Observable<MyAchievements> {
    return this.api.get<MyAchievements>(BASE);
  }

  /// Earned tiers not seen yet, oldest unlock first.
  unseen(): Observable<UnseenAchievements> {
    return this.api.get<UnseenAchievements>(`${BASE}/unseen`);
  }

  /// Marks every earned, unseen tier of these achievements (1 to 100 ids) seen and returns what
  /// is still unseen.
  markSeen(ids: readonly string[]): Observable<UnseenAchievements> {
    return this.api.post<UnseenAchievements>(`${BASE}/seen`, { ids });
  }

  /// Shares an earned achievement with every signed-in user; returns the item with `shared: true`.
  share(id: string): Observable<MyAchievement> {
    return this.api.put<MyAchievement>(`${BASE}/${encodeURIComponent(id)}/share`, {});
  }

  /// Stops sharing it; returns the item with `shared: false`.
  unshare(id: string): Observable<MyAchievement> {
    return this.api.delete<MyAchievement>(`${BASE}/${encodeURIComponent(id)}/share`);
  }

  /// Another user's shared achievements in catalogue order. 404 `user.notFound` when the owner is
  /// unknown, deactivated, opted out or has the flag off; 404 `achievements.disabled` while the
  /// flag is off for the viewer.
  sharedBy(userId: string): Observable<SharedAchievements> {
    return this.api.get<SharedAchievements>(`/users/${encodeURIComponent(userId)}/achievements`);
  }
}
