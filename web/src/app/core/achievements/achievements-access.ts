import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../flags/feature-flag.service';
import { ACHIEVEMENTS_FLAG } from './achievement.models';

/// Whether achievements show for the signed-in user: the `achievements` flag is on and the API
/// has not answered `achievements.disabled` (an opt-out) for this user in this session.
@Injectable({ providedIn: 'root' })
export class AchievementsAccess {
  private readonly flags = inject(FeatureFlagService);
  private readonly auth = inject(AuthService);
  private readonly disabledFor = signal<string | null>(null);

  readonly flagOn = computed(() => this.flags.isOn(ACHIEVEMENTS_FLAG));
  readonly enabled = computed(() => {
    const userId = this.auth.currentUser()?.id;
    return this.flagOn() && !!userId && this.disabledFor() !== userId;
  });

  /// The API said `achievements.disabled` although the flag is on: the user opted out.
  markDisabled(): void {
    this.disabledFor.set(this.auth.currentUser()?.id ?? null);
  }

  /// The user opted (back) in, or the API answered again.
  markEnabled(): void {
    this.disabledFor.set(null);
  }
}
