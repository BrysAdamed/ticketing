import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { ACCESS_TOKENS_VIEW, PROFILE_GENERAL_VIEW, PROFILE_LAYOUT_VIEW } from './profile.views';

export default [
  viewRoute(PROFILE_LAYOUT_VIEW, {
    path: '',
    children: [
      viewRoute(PROFILE_GENERAL_VIEW, { path: '' }),
      viewRoute(ACCESS_TOKENS_VIEW, { path: 'tokens', data: { breadcrumb: 'Access tokens' } }),
    ],
  }),
] satisfies Routes;
