import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../flags/feature-flag.service';
import { ACHIEVEMENTS_FLAG } from './achievement.models';

interface HiddenOverride {
  userId: string;
  hidden: boolean;
}

/// Whether achievements show for the signed-in user: the `achievements` flag is on and the user
/// has not opted out. The opt-out comes from `/me` (`achievementsHidden`) and is overridden for
/// the rest of the session by what happened since: an opt-out or opt-in saved on the profile, or
/// an `achievements.disabled` answer from the API.
@Injectable({ providedIn: 'root' })
export class AchievementsAccess {
  private readonly flags = inject(FeatureFlagService);
  private readonly auth = inject(AuthService);
  private readonly override = signal<HiddenOverride | null>(null);
  private changes = 0;

  readonly flagOn = computed(() => this.flags.isOn(ACHIEVEMENTS_FLAG));
  readonly enabled = computed(() => {
    const user = this.auth.currentUser();
    if (!this.flagOn() || !user) return false;
    const override = this.override();
    const hidden = override?.userId === user.id ? override.hidden : !!user.achievementsHidden;
    return !hidden;
  });

  /// Taken before an API call whose `achievements.disabled` answer would call `markDisabled(since)`.
  since(): number {
    return this.changes;
  }

  /// The user opted out, or the API said `achievements.disabled` although the flag is on. Pass the
  /// `since()` taken before the request: an answer to a request sent before a newer opt-in or opt-out
  /// is stale (the opt-in may not have been saved yet) and is ignored.
  markDisabled(since?: number): void {
    if (since !== undefined && since !== this.changes) return;
    this.mark(true);
  }

  /// The user opted (back) in, or the API answered again.
  markEnabled(): void {
    this.mark(false);
  }

  private mark(hidden: boolean): void {
    const userId = this.auth.currentUser()?.id;
    this.changes++;
    this.override.set(userId ? { userId, hidden } : null);
  }
}
