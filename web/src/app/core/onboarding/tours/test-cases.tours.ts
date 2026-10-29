import { TourDefinition } from '../engine/tour.model';

/// Tour of a project's test cases (spec 6.10, 14.4). Writers get five steps, Viewers four (no
/// "New test case"). The list step points at the list or at its empty state; the "last result"
/// step only shows while there are test cases.
export const TEST_CASES_TOUR: TourDefinition = {
  id: 'tour.testcases.list',
  version: 1,
  viewId: 'testcases.list',
  title: 'Test cases',
  steps: [
    {
      id: 'new',
      anchor: 'testcases.new',
      requires: 'write',
      title: 'Write a test case',
      body: 'Title, preconditions, steps and the expected result, optionally linked to the ticket it checks. N opens a new one.',
    },
    {
      id: 'statuses',
      anchor: 'testcases.status',
      title: 'Statuses',
      body: 'New means not ready yet. Manual cases need at least one step and are run by people; Automatic ones pass by themselves in every regression session.',
    },
    {
      id: 'list',
      anchor: 'testcases.list',
      placement: 'start',
      title: 'The test cases',
      body: 'Click a row to open it beside the list. J and K move between rows. Manual and Automatic cases join every new regression session.',
    },
    {
      id: 'last-result',
      anchor: 'testcases.last-result',
      placement: 'start',
      title: 'Last result',
      body: 'How the case did in its latest regression session: passed, failed or skipped.',
    },
    {
      id: 'filters',
      anchor: 'testcases.filters',
      title: 'Find a case',
      body: 'Filter by title or key, by the linked ticket, or show archived cases. Archived cases stay out of new sessions.',
    },
  ],
};
