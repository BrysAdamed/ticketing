import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import {
  ADMIN_LAYOUT_VIEW,
  ADMIN_USERS_VIEW,
  AUDIT_LOG_VIEW,
  FEATURE_FLAGS_VIEW,
} from './admin.views';

export default [
  viewRoute(ADMIN_LAYOUT_VIEW, {
    path: '',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      viewRoute(ADMIN_USERS_VIEW, { path: 'users', title: 'Users', data: { breadcrumb: 'Users' } }),
      viewRoute(FEATURE_FLAGS_VIEW, {
        path: 'flags',
        title: 'Feature flags',
        data: { breadcrumb: 'Feature flags' },
      }),
      viewRoute(AUDIT_LOG_VIEW, {
        path: 'audit',
        title: 'Audit log',
        data: { breadcrumb: 'Audit log' },
      }),
    ],
  }),
] satisfies Routes;
