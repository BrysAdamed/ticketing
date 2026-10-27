import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { TEST_CASE_EDITOR_VIEW, TEST_CASES_VIEW } from './test-cases.views';

export default [
  viewRoute(TEST_CASES_VIEW, {
    path: '',
    children: [
      viewRoute(TEST_CASE_EDITOR_VIEW, { path: 'new', data: { breadcrumb: 'New' } }),
      viewRoute(TEST_CASE_EDITOR_VIEW, {
        path: ':testCaseKey',
        data: {
          breadcrumb: (route: ActivatedRouteSnapshot) =>
            (route.paramMap.get('testCaseKey') ?? '').toUpperCase(),
        },
      }),
    ],
  }),
] satisfies Routes;
