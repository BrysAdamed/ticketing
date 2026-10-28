import { TourDefinition } from '@core/onboarding/engine/tour.model';

/// TKT-53 prototype tours for the engine demo in the UI kit. The real backlog tour and its copy are
/// written by TKT-56 in `core/onboarding/tours/`.
export const PROTOTYPE_BACKLOG_TOUR: TourDefinition = {
  id: 'dev.tour-prototype.backlog',
  version: 1,
  viewId: 'backlog.list',
  title: 'Backlog (prototype)',
  steps: [
    {
      id: 'new-ticket',
      anchor: 'backlog.new-ticket',
      route: '/projects/:projectKey/backlog',
      requires: 'write',
      title: 'Create a ticket',
      body: 'New work lands in the backlog first. Press C on this page to add a ticket inline.',
    },
    {
      id: 'group-sort',
      anchor: 'backlog.group-sort',
      route: '/projects/:projectKey/backlog',
      title: 'Group and sort',
      body: 'Group by status, assignee or epic. Sort by rank to drag tickets into priority order.',
    },
    {
      id: 'list',
      anchor: 'backlog.list',
      route: '/projects/:projectKey/backlog',
      placement: 'start',
      title: 'Everything not on a board',
      body: 'A ticket lives in one place: here in the backlog, or on one board.',
    },
  ],
};

export const PROTOTYPE_UI_KIT_TOUR: TourDefinition = {
  id: 'dev.tour-prototype.ui-kit',
  version: 1,
  viewId: 'dev.ui-kit',
  title: 'UI kit (prototype)',
  steps: [
    {
      id: 'types',
      anchor: 'dev.ui-kit.types',
      title: 'Ticket types',
      body: 'Coloured glyphs, no tiles. The same set is used in every list.',
    },
    {
      id: 'missing',
      anchor: 'dev.ui-kit.missing',
      title: 'Missing anchor',
      body: 'This step is skipped because no element exposes its anchor.',
    },
    {
      id: 'admin',
      anchor: 'dev.ui-kit.statuses',
      requires: 'admin',
      title: 'Statuses (Admins only)',
      body: 'A step with requires: admin. Other users never see it.',
    },
    {
      id: 'demo',
      anchor: 'dev.ui-kit.tour',
      placement: 'above',
      title: 'Back where you started',
      body: 'Done, Skip or Esc closes the tour and focus returns to the button that started it.',
    },
  ],
};
