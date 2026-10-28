import type { TourDefinition } from '../engine/tour.model';

/// A view that has a tour. The definition (its copy) is loaded on demand, so adding tours never
/// grows the initial bundle. Plain TypeScript: e2e specs may import this file.
export interface TourCatalogueEntry {
  readonly viewId: string;
  /// Same as the definition's title; names the palette command ("Backlog tour").
  readonly title: string;
  /// Where the view lives when a project is all it needs (`/projects/:projectKey/backlog`). The
  /// palette command can then start the tour from anywhere; without it, only on the view itself.
  readonly path?: string;
  readonly load: () => Promise<TourDefinition>;
}

/// Every per-view tour, keyed by view id (spec 14.4, D-129).
export const TOUR_CATALOGUE: readonly TourCatalogueEntry[] = [
  {
    viewId: 'backlog.list',
    title: 'Backlog',
    path: '/projects/:projectKey/backlog',
    load: () => import('./backlog.tours').then((m) => m.BACKLOG_TOUR),
  },
  {
    viewId: 'board.kanban',
    title: 'Board',
    load: () => import('./board.tours').then((m) => m.BOARD_TOUR),
  },
  {
    viewId: 'ticket.detail',
    title: 'Ticket',
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
