import { Routes } from '@angular/router';
import { ACHIEVEMENTS_FLAG } from '@core/achievements/achievement.models';
import { featureGuard } from '@core/flags/feature.guard';
import { viewRoute } from '@core/views/view-registry';
import {
  ACCESS_TOKENS_VIEW,
  PROFILE_ACHIEVEMENTS_VIEW,
  PROFILE_GENERAL_VIEW,
  PROFILE_LAYOUT_VIEW,
} from './profile.views';

export default [
  viewRoute(PROFILE_LAYOUT_VIEW, {
    path: '',
    children: [
      viewRoute(PROFILE_GENERAL_VIEW, { path: '' }),
      viewRoute(ACCESS_TOKENS_VIEW, {
        path: 'tokens',
        title: 'Access tokens',
        data: { breadcrumb: 'Access tokens' },
      }),
      viewRoute(PROFILE_ACHIEVEMENTS_VIEW, {
        path: 'achievements',
        title: 'Achievements',
        canMatch: [featureGuard(ACHIEVEMENTS_FLAG)],
        data: { breadcrumb: 'Achievements' },
      }),
    ],
  }),
] satisfies Routes;
