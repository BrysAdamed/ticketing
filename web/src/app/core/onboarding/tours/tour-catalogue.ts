import type { TourDefinition, TourRequirement } from '../engine/tour.model';

/// What a tour without a `path` opens to start away from its view: a ticket, a board or a
/// regression session the user can read (`TourTargets`, D-170).
export type TourTargetKind = 'ticket' | 'board' | 'regression-session';

/// A view that has a tour. The definition (its copy) is loaded on demand, so adding tours never
/// grows the initial bundle. Plain TypeScript: e2e specs may import this file.
export interface TourCatalogueEntry {
  readonly viewId: string;
  /// Same as the definition's title; names the palette command ("Backlog tour").
  readonly title: string;
  /// Where the view lives when it needs at most a project (`/projects/:projectKey/backlog`,
  /// `/search`). The palette command can then start the tour from anywhere; without it, only on
  /// the view itself or through `opens`.
  readonly path?: string;
  /// Who the whole tour is for (`project.settings` is for Owners, `admin.users` for Admins). Others
  /// get neither "Tour of this page" nor the palette command. Checked against the open project and
  /// the instance role, so a tour that needs `write` or `owner` has no `path`.
  readonly requires?: TourRequirement;
  /// What the tour opens first when it starts away from its view and has no `path`.
  readonly opens?: TourTargetKind;
  readonly load: () => Promise<TourDefinition>;
}

/// Every per-view tour, keyed by view id (spec 14.4, D-131).
export const TOUR_CATALOGUE: readonly TourCatalogueEntry[] = [
  {
    viewId: 'backlog.list',
    title: 'Backlog',
    path: '/projects/:projectKey/backlog',
    load: () => import('./backlog.tours').then((m) => m.BACKLOG_TOUR),
  },
  {
    viewId: 'project.dashboard',
    title: 'Dashboard',
    path: '/projects/:projectKey/dashboard',
    load: () => import('./dashboard.tours').then((m) => m.DASHBOARD_TOUR),
  },
  {
    viewId: 'search.results',
    title: 'Search',
    path: '/search',
    load: () => import('./search.tours').then((m) => m.SEARCH_TOUR),
  },
  {
    viewId: 'testcases.list',
    title: 'Test cases',
    path: '/projects/:projectKey/test-cases',
    load: () => import('./test-cases.tours').then((m) => m.TEST_CASES_TOUR),
  },
  {
    viewId: 'regressions.session',
    title: 'Regression session',
    opens: 'regression-session',
    load: () => import('./regressions.tours').then((m) => m.REGRESSION_SESSION_TOUR),
  },
  {
    viewId: 'project.settings',
    title: 'Project settings',
    requires: 'owner',
    load: () => import('./project-settings.tours').then((m) => m.PROJECT_SETTINGS_TOUR),
  },
  {
    viewId: 'admin.users',
    title: 'Users',
    path: '/admin/users',
    requires: 'admin',
    load: () => import('./admin-users.tours').then((m) => m.ADMIN_USERS_TOUR),
  },
  {
    viewId: 'board.kanban',
    title: 'Board',
    opens: 'board',
    load: () => import('./board.tours').then((m) => m.BOARD_TOUR),
  },
  {
    viewId: 'ticket.detail',
    title: 'Ticket',
    opens: 'ticket',
    load: () => import('./ticket.tours').then((m) => m.TICKET_TOUR),
  },
];

/// Guide id stored in the onboarding state for the tour of a view.
export function tourGuideId(viewId: string): string {
  return `tour.${viewId}`;
}

/// Palette command (Help group) that starts the tour of a view.
export function tourCommandId(viewId: string): string {
  return `help.tour.${viewId}`;
}

/// Whether a catalogue path opens a view inside a project (it has the `:projectKey` param).
export function pathNeedsProject(path: string): boolean {
  return path.includes(':projectKey');
}
