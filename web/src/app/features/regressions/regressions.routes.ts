import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { REGRESSION_SESSION_VIEW, REGRESSIONS_LIST_VIEW } from './regressions.views';

export default [
  viewRoute(REGRESSIONS_LIST_VIEW, { path: '' }),
  viewRoute(REGRESSION_SESSION_VIEW, {
    path: ':sessionKey',
    data: { breadcrumb: (route: ActivatedRouteSnapshot) => route.paramMap.get('sessionKey') ?? '' },
  }),
] satisfies Routes;
