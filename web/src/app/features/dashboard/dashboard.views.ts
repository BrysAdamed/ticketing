import { defineView } from '@core/views/view-definition';

export const DASHBOARD_VIEW = defineView({
  viewId: 'project.dashboard',
  variants: { default: () => import('./dashboard.view').then((m) => m.DashboardView) },
});
