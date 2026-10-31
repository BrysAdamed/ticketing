import { TourDefinition } from '../engine/tour.model';

/// Tour of a project's backlog (spec 14.4). Writers get six steps, Viewers three (the list, group
/// and sort, "on boards"). The rank and select steps point at the first ticket row, and the
/// "on boards" step only shows while some of the project's tickets are on boards.
export const BACKLOG_TOUR: TourDefinition = {
  id: 'tour.backlog.list',
  version: 1,
  viewId: 'backlog.list',
  title: 'Backlog',
  steps: [
    {
      id: 'quick-create',
      anchor: 'backlog.quick-create',
      requires: 'write',
      title: 'Create a ticket',
      body: 'New work lands in the backlog first. New ticket, or C on this page, opens a row at the top: type a title and press Enter.',
    },
    {
      id: 'list',
      anchor: 'backlog.list',
      placement: 'start',
      title: 'Everything not on a board',
      body: 'The backlog lists the tickets of this project that are not placed on a board. J and K move between rows, Enter opens one.',
    },
    {
      id: 'rank',
      anchor: 'backlog.rank',
      requires: 'write',
      title: 'Rank by dragging',
      body: 'Drag a row up or down to set its priority order. Dragging works while the list is sorted by rank.',
    },
    {
      id: 'bulk',
      anchor: 'backlog.select',
      requires: 'write',
      placement: 'end',
      title: 'Change many at once',
      body: 'Tick rows, or press X on the focused row. A bulk bar appears to change status, priority, assignee, type or labels, or to move the tickets to a board.',
    },
    {
      id: 'group-sort',
      anchor: 'backlog.group-sort',
      title: 'Group and sort',
      body: 'Group by status, type, epic or assignee, and sort by rank, priority or date.',
    },
    {
      id: 'on-boards',
      anchor: 'backlog.on-boards',
      placement: 'above',
      title: 'Tickets on boards',
      body: 'A ticket lives in one place: its backlog or one board. Tickets placed on boards leave this list; this panel counts them. Drag tickets onto a board here to move them.',
    },
  ],
};
