import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { MyAchievements, UnseenAchievements } from './achievement.models';

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
}
