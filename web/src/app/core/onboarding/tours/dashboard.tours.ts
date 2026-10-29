import { TourDefinition, TourStep } from '../engine/tour.model';

/// Steps of the project dashboard tour (spec 7, 14.4): totals, every count is a search, by status,
/// created vs resolved, epic progress. Read-only, so everyone gets all five. An empty dashboard
/// still shows these widgets at zero under its empty state, and the copy says what will appear.
/// Exported on their own so the "Your first project" walkthrough (TKT-80) can end with them.
export const DASHBOARD_TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'totals',
    anchor: 'dashboard.totals',
    title: 'Totals',
    body: 'Open and done tickets, open story points and unassigned open tickets of the whole project. A new project starts at zero; they count up as tickets are created and closed.',
  },
  {
    id: 'count-links',
    anchor: 'dashboard.count-link',
    title: 'Every count is a search',
    body: 'Click any number, bar or week to open the search that produces it, with the same filters, ready to refine or export.',
  },
  {
    id: 'by-status',
    anchor: 'dashboard.by-status',
    placement: 'end',
    title: 'By status',
    body: 'Every ticket of the project per status, all eight shown even at zero. Statuses move freely, so this is where work really stands.',
  },
  {
    id: 'created-resolved',
    anchor: 'dashboard.created-resolved',
    placement: 'start',
    title: 'Created vs resolved',
    body: 'Tickets created and tickets that reached Done, per week over the last 12 weeks. While nothing moves the lines stay flat; a growing gap means work piles up.',
  },
  {
    id: 'epic-progress',
    anchor: 'dashboard.epic-progress',
    placement: 'above',
    title: 'Epic progress',
    body: 'Each open epic with its direct children done out of total, by count and by story points. Create an epic and give it sub-tickets to see it here.',
  },
];

export const DASHBOARD_TOUR: TourDefinition = {
  id: 'tour.project.dashboard',
  version: 1,
  viewId: 'project.dashboard',
  title: 'Dashboard',
  steps: DASHBOARD_TOUR_STEPS,
};
