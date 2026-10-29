import { defineView } from '@core/views/view-definition';

export const PROFILE_LAYOUT_VIEW = defineView({
  viewId: 'profile.layout',
  variants: {
    default: () => import('./layout/profile-layout.view').then((m) => m.ProfileLayoutView),
  },
});

export const PROFILE_GENERAL_VIEW = defineView({
  viewId: 'profile.general',
  variants: {
    default: () => import('./general/profile-general.view').then((m) => m.ProfileGeneralView),
  },
});

export const ACCESS_TOKENS_VIEW = defineView({
  viewId: 'profile.tokens',
  variants: {
    default: () => import('./tokens/access-tokens.view').then((m) => m.AccessTokensView),
  },
});

export const PROFILE_ACHIEVEMENTS_VIEW = defineView({
  viewId: 'profile.achievements',
  variants: {
    default: () =>
      import('./achievements/profile-achievements.view').then((m) => m.ProfileAchievementsView),
  },
});
