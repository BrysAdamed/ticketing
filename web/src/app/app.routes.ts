import { Routes } from '@angular/router';
import { adminGuard, authGuard, guestGuard } from '@core/auth/auth.guards';
import { ShellComponent } from '@core/layout/shell/shell.component';

/// Top-level routes only. Every feature owns its sub-tree in `features/<feature>/*.routes.ts`
/// and every page is resolved through the view registry (`viewRoute`).
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in · Ticketing',
    canActivate: [guestGuard],
    loadChildren: () => import('@features/auth/auth.routes').then((m) => m.LOGIN_ROUTES),
  },
  {
    path: 'set-password',
    title: 'Set password · Ticketing',
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
        title: 'My work · Ticketing',
        data: { breadcrumb: 'My work' },
        loadChildren: () => import('@features/my-work/my-work.routes'),
      },
      {
        path: 'projects',
        title: 'Projects · Ticketing',
        data: { breadcrumb: 'Projects' },
        loadChildren: () => import('@features/projects/projects.routes'),
      },
      {
        path: 'tickets',
        loadChildren: () => import('@features/tickets/tickets.routes'),
      },
      {
        path: 'boards',
        title: 'Boards · Ticketing',
        data: { breadcrumb: 'Boards' },
        loadChildren: () => import('@features/boards/boards.routes'),
      },
      {
        path: 'search',
        title: 'Search · Ticketing',
        data: { breadcrumb: 'Search' },
        loadChildren: () => import('@features/search/search.routes'),
      },
      {
        path: 'profile',
        title: 'Profile · Ticketing',
        data: { breadcrumb: 'Profile' },
        loadChildren: () => import('@features/profile/profile.routes'),
      },
      {
        path: 'admin',
        title: 'Admin · Ticketing',
        canMatch: [adminGuard],
        data: { breadcrumb: 'Admin' },
        loadChildren: () => import('@features/admin/admin.routes'),
      },
      {
        path: '**',
        title: 'Not found · Ticketing',
        loadChildren: () => import('@features/not-found/not-found.routes'),
      },
    ],
  },
];
