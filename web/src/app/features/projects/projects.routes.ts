import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { CrumbInput } from '@core/layout/breadcrumbs';
import { viewRoute } from '@core/views/view-registry';
import { PROJECT_LAYOUT_VIEW, PROJECTS_LIST_VIEW } from './projects.views';

const projectCrumb = (route: ActivatedRouteSnapshot): CrumbInput => {
  const key = (route.paramMap.get('projectKey') ?? '').toUpperCase();
  return { label: key, projectKey: key };
};

/// Project tabs. Each tab's page lives in its own feature folder and owns its routes.
export default [
  viewRoute(PROJECTS_LIST_VIEW, { path: '' }),
  viewRoute(PROJECT_LAYOUT_VIEW, {
    path: ':projectKey',
    data: { breadcrumb: projectCrumb },
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        title: 'Dashboard',
        data: { breadcrumb: 'Dashboard' },
        loadChildren: () => import('@features/dashboard/dashboard.routes'),
      },
      {
        path: 'backlog',
        title: 'Backlog',
        data: { breadcrumb: 'Backlog' },
        loadChildren: () => import('@features/backlog/backlog.routes'),
      },
      {
        path: 'test-cases',
        title: 'Test cases',
        data: { breadcrumb: 'Test cases' },
        loadChildren: () => import('@features/test-cases/test-cases.routes'),
      },
      {
        path: 'regressions',
        title: 'Regressions',
        data: { breadcrumb: 'Regressions' },
        loadChildren: () => import('@features/regressions/regressions.routes'),
      },
      {
        path: 'settings',
        title: 'Settings',
        data: { breadcrumb: 'Settings' },
        loadChildren: () => import('@features/project-settings/project-settings.routes'),
      },
    ],
  }),
] satisfies Routes;
