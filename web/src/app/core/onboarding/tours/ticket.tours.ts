import { TourDefinition } from '../engine/tour.model';

/// Tour of the ticket page (spec 14.4). Writers get up to seven steps, Viewers five (no @mentions,
/// no Delegate). Access comes from the ticket itself (D-138). Sub-tickets are skipped on a spike
/// without children, and Delegate only shows while agent delegation is on for the project: the
/// Delegate button exposes its anchor only when it is visible.
export const TICKET_TOUR: TourDefinition = {
  id: 'tour.ticket.detail',
  version: 1,
  viewId: 'ticket.detail',
  title: 'Ticket',
  steps: [
    {
      id: 'fields',
      anchor: 'ticket.fields',
      placement: 'start',
      title: 'Status and fields',
      body: 'Status, assignee, priority, labels and where the ticket lives. Any status can move to any other; S, A and P open the pickers.',
    },
    {
      id: 'sub-tickets',
      anchor: 'ticket.sub-tickets',
      title: 'Sub-tickets',
      body: 'Break the work down into sub-tickets. Their progress adds up here, and once there are some, the graph view shows the whole tree.',
    },
    {
      id: 'links',
      anchor: 'ticket.links',
      title: 'Links',
      body: 'Relate tickets across projects: blocks, relates to, duplicates. Links you cannot read on the other side are left out.',
    },
    {
      id: 'watch',
      anchor: 'ticket.watch',
      placement: 'below',
      title: 'Watch',
      body: 'Watch a ticket, or press W, to follow its changes and comments. The count shows who else is watching.',
    },
    {
      id: 'mentions',
      anchor: 'ticket.comment',
      requires: 'write',
      placement: 'above',
      title: '@mentions',
      body: 'Type @ in a comment or the description to mention someone who can read the project. Ctrl Enter posts the comment.',
    },
    {
      id: 'test-cases',
      anchor: 'ticket.test-cases',
      title: 'Test cases',
      body: "The test cases that cover this ticket, with their status and last regression result. They're run in regression sessions.",
    },
    {
      id: 'delegate',
      anchor: 'ticket.delegate',
      requires: 'write',
      placement: 'below',
      title: 'Delegate to agent',
      body: 'Hand this ticket to an AI coding agent: Claude opens with a prompt built from the ticket. The arrow next to it copies or previews the prompt.',
    },
  ],
};
