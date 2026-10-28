import { TourDefinition, TourStep } from '../engine/tour.model';
import { DASHBOARD_TOUR_STEPS } from '../tours/dashboard.tours';

/// Conditions of the walkthrough's action-driven steps, read from real data by
/// `FirstProjectConditions` (D-140). Each reports the params later steps need.
export const FIRST_PROJECT_CONDITIONS = {
  /// The chosen project exists and is live, or a project the user owns appeared that was not
  /// there when the walkthrough started (`ownedBefore`). Learns `projectKey`.
  projectCreated: 'project.created',
  /// The user reported a ticket in the project. Learns `ticketKey` (the newest).
  ticketCreated: 'ticket.created',
  /// The ticket's status changed since it was created.
  statusChanged: 'ticket.status-changed',
  /// A live board links the project (the ticket's board first). Learns `boardId`.
  boardLinksProject: 'board.links-project',
  /// The ticket's location is a board. Learns that `boardId`.
  ticketOnBoard: 'ticket.on-board',
} as const;

/// Custom step actions run by `FirstProjectConditions.run`.
export const FIRST_PROJECT_ACTIONS = {
  createProject: 'create-project',
  createBoard: 'create-board',
} as const;

/// Suggested values (spec 14.4); the project name is "<display name>'s sandbox".
export const FIRST_PROJECT_SUGGESTIONS = {
  projectSuffix: "'s sandbox",
  ticketTitle: 'My first ticket',
  boardName: 'My first board',
} as const;

const DASHBOARD_ROUTE = '/projects/:projectKey/dashboard';

/// "Your first project" walkthrough (spec 14.4, TKT-80): the user creates a private project, a
/// ticket, optionally changes its status, creates a board, places the ticket on it and ends on the
/// project dashboard tour. Plain data with stable ids; `{param}` placeholders are filled from what
/// the walkthrough learnt (`suggestedName`, `suggestedKey`, `projectKey`, `ticketKey`).
export const FIRST_PROJECT_TOUR: TourDefinition = {
  id: 'tour.first-project',
  version: 1,
  viewId: 'first-project',
  title: 'Your first project',
  kind: 'walkthrough',
  steps: [
    {
      id: 'create-project',
      anchor: 'projects.new',
      route: '/projects',
      advanceWhen: { kind: 'condition', id: FIRST_PROJECT_CONDITIONS.projectCreated },
      action: {
        label: 'Create the project',
        does: 'custom',
        id: FIRST_PROJECT_ACTIONS.createProject,
      },
      waiting: 'Waiting for you to create the project',
      title: 'Create a private project',
      body: 'We suggest "{suggestedName}" with the key {suggestedKey}, and Private: other people can\'t see it, and to them it answers not found. Check the dialog and confirm; nothing is created until you do.',
    },
    {
      id: 'create-ticket',
      anchor: 'backlog.quick-create',
      route: '/projects/:projectKey/backlog',
      advanceWhen: { kind: 'condition', id: FIRST_PROJECT_CONDITIONS.ticketCreated },
      action: { label: 'New ticket', does: 'click-anchor' },
      waiting: 'Waiting for your first ticket',
      title: 'Create a ticket',
      body: `New work lands in the backlog first. Press C or New ticket, type "${FIRST_PROJECT_SUGGESTIONS.ticketTitle}" and press Enter.`,
    },
    {
      id: 'change-status',
      anchor: 'backlog.status',
      route: '/projects/:projectKey/backlog',
      optional: true,
      advanceWhen: { kind: 'condition', id: FIRST_PROJECT_CONDITIONS.statusChanged },
      action: { label: 'Change the status', does: 'click-anchor' },
      waiting: 'Waiting for a new status on {ticketKey}',
      title: 'Change its status',
      body: 'Any status can move to any other: there is no workflow to configure. Click the status of {ticketKey}, or focus its row and press S, and pick another one, for example In Progress. You can also skip this step.',
    },
    {
      id: 'create-board',
      anchor: 'boards.new',
      route: '/boards',
      advanceWhen: { kind: 'condition', id: FIRST_PROJECT_CONDITIONS.boardLinksProject },
      action: { label: 'Create the board', does: 'custom', id: FIRST_PROJECT_ACTIONS.createBoard },
      waiting: 'Waiting for a board that links {projectKey}',
      title: 'Create a board',
      body: `Boards plan work from one or more projects. We suggest "${FIRST_PROJECT_SUGGESTIONS.boardName}", linked to {projectKey}.`,
    },
    {
      id: 'place-ticket',
      anchor: 'board.add-tickets',
      route: '/boards/:boardId',
      advanceWhen: { kind: 'condition', id: FIRST_PROJECT_CONDITIONS.ticketOnBoard },
      action: { label: 'Add tickets', does: 'click-anchor' },
      waiting: 'Waiting for {ticketKey} on the board',
      title: 'Place the ticket on the board',
      body: 'A ticket lives in exactly one place: its backlog or one board. Add {ticketKey} here from the backlog, or use Move to… in the backlog.',
    },
    ...DASHBOARD_TOUR_STEPS.map(
      (step): TourStep => ({
        ...step,
        id: `dashboard-${step.id}`,
        route: DASHBOARD_ROUTE,
        stage: 'dashboard',
      }),
    ),
    {
      id: 'finish',
      anchor: 'project.nav-settings',
      route: DASHBOARD_ROUTE,
      placement: 'end',
      title: 'Keep it, share it or archive it',
      body: 'The project is yours. Keep it to try things out, invite people or make it public in Settings, or archive it when you are done. Only Admins can delete a project, once it is archived, and its key {projectKey} stays reserved.',
    },
  ],
};

/// Copy of the walkthrough's start choice (step 0), for a user who already owns a project.
export const FIRST_PROJECT_CHOICE = {
  title: 'Your first project',
  body: 'You already own {projectName}. Walk through the steps with it, or create a private practice project to try things out.',
  use: 'Use {projectName}',
  create: 'Create a practice project',
  cancel: 'Cancel',
} as const;
