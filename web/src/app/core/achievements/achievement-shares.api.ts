import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { MyAchievement, SharedAchievements } from './achievement.models';

/// Sharing achievements with other signed-in users (spec 15.12, D-155). Apart from
/// `AchievementsApi` so the eager unlock poller does not carry it into the initial bundle.
@Injectable({ providedIn: 'root' })
export class AchievementSharesApi {
  private readonly api = inject(ApiClient);

  /// Shares an earned achievement with every signed-in user; returns the item with `shared: true`.
  share(id: string): Observable<MyAchievement> {
    return this.api.put<MyAchievement>(`/me/achievements/${encodeURIComponent(id)}/share`, {});
  }

  /// Stops sharing it; returns the item with `shared: false`.
  unshare(id: string): Observable<MyAchievement> {
    return this.api.delete<MyAchievement>(`/me/achievements/${encodeURIComponent(id)}/share`);
  }

  /// Another user's shared achievements in catalogue order. 404 `user.notFound` when the owner is
  /// unknown, deactivated, opted out or has the flag off; 404 `achievements.disabled` while the
  /// flag is off for the viewer.
  sharedBy(userId: string): Observable<SharedAchievements> {
    return this.api.get<SharedAchievements>(`/users/${encodeURIComponent(userId)}/achievements`);
  }
}
