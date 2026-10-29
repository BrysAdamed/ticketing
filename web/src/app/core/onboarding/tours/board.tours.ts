import { TourDefinition } from '../engine/tour.model';

/// Tour of a kanban board (spec 14.4). Writers get four steps, Viewers (and everyone on an archived
/// board) three: no placing step. Access comes from the board itself, not an open project (D-138):
/// writing means the board is not archived and the user can write to one of its projects.
export const BOARD_TOUR: TourDefinition = {
  id: 'tour.board.kanban',
  version: 1,
  viewId: 'board.kanban',
  title: 'Board',
  steps: [
    {
      id: 'columns',
      anchor: 'board.columns',
      title: 'Columns are statuses',
      body: 'Each column is one status. Any status can move to any other: there is no workflow to follow and nothing to configure.',
    },
    {
      id: 'swimlanes',
      anchor: 'board.swimlanes',
      title: 'Swimlanes',
      body: 'Split the columns into rows by assignee, epic, priority or project. Collapse a lane or a column to make room.',
    },
    {
      id: 'place',
      anchor: 'board.add-tickets',
      requires: 'write',
      title: 'Place cards',
      body: 'Add tickets pulls them from the backlogs of the linked projects; a ticket is in its backlog or on one board. Drag a card to another column to change its status, or within a column to rank it.',
    },
    {
      id: 'hidden-cards',
      anchor: 'board.counts',
      title: 'Only what you can read',
      body: 'A board can link projects you cannot read. Their cards are left out of the columns and the counts, as if they were not there.',
    },
  ],
};
