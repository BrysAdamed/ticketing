import { defineView } from '@core/views/view-definition';

export const REGRESSIONS_LIST_VIEW = defineView({
  viewId: 'regressions.list',
  variants: { default: () => import('./list/regressions.view').then((m) => m.RegressionsView) },
});

export const REGRESSION_SESSION_VIEW = defineView({
  viewId: 'regressions.session',
  variants: {
    default: () => import('./session/regression-session.view').then((m) => m.RegressionSessionView),
  },
});
