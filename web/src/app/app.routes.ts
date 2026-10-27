import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from '@core/auth/auth.guards';
import { ShellComponent } from '@core/layout/shell/shell.component';

/// Top-level routes only. Every feature owns its sub-tree in `features/<feature>/*.routes.ts`
/// and every page is resolved through the view registry (`viewRoute`).
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in',
    canActivate: [guestGuard],
    loadChildren: () => import('@features/auth/auth.routes').then((m) => m.LOGIN_ROUTES),
  },
  {
    path: 'set-password',
    title: 'Set password',
    loadChildren: () => import('@features/auth/auth.routes').then((m) => m.SET_PASSWORD_ROUTES),
  },
  {
    path: '',
    component: ShellComponent,
    canActivate: [authGuard],
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'my-work' },
      {
        path: 'my-work',
        title: 'My work',
        data: { breadcrumb: 'My work' },
        loadChildren: () => import('@features/my-work/my-work.routes'),
      },
      {
        path: 'projects',
        title: 'Projects',
        data: { breadcrumb: 'Projects' },
        loadChildren: () => import('@features/projects/projects.routes'),
      },
      {
        path: 'tickets',
        loadChildren: () => import('@features/tickets/tickets.routes'),
      },
      {
        path: 'boards',
        title: 'Boards',
        data: { breadcrumb: 'Boards' },
        loadChildren: () => import('@features/boards/boards.routes'),
      },
      {
        path: 'search',
        title: 'Search',
        data: { breadcrumb: 'Search' },
        loadChildren: () => import('@features/search/search.routes'),
      },
      {
        path: 'profile',
        title: 'Profile',
        data: { breadcrumb: 'Profile' },
        loadChildren: () => import('@features/profile/profile.routes'),
      },
      {
        path: 'admin',
        title: 'Admin',
        canMatch: [adminGuard],
        data: { breadcrumb: 'Admin' },
        loadChildren: () => import('@features/admin/admin.routes'),
      },
      {
        path: 'dev/ui-kit',
        title: 'UI kit',
        data: { breadcrumb: 'UI kit' },
        loadChildren: () => import('@features/ui-kit/ui-kit.routes'),
      },
      {
        path: '**',
        title: 'Not found',
        loadChildren: () => import('@features/not-found/not-found.routes'),
      },
    ],
  },
];
