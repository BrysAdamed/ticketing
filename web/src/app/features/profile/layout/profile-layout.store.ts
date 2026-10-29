import { computed, inject, Injectable } from '@angular/core';
import { AchievementsAccess } from '@core/achievements/achievements-access';
import { RouteTab } from '@shared/ui/route-tabs/route-tabs.component';

const GENERAL: RouteTab = { path: '', label: 'Profile', exact: true };
const TOKENS: RouteTab = { path: 'tokens', label: 'Access tokens' };
const ACHIEVEMENTS: RouteTab = { path: 'achievements', label: 'Achievements' };

@Injectable()
export class ProfileLayoutStore {
  private readonly achievements = inject(AchievementsAccess);

  readonly title = 'Profile';
  readonly tabs = computed<readonly RouteTab[]>(() =>
    this.achievements.enabled() ? [GENERAL, TOKENS, ACHIEVEMENTS] : [GENERAL, TOKENS],
  );
}
