import { TourDefinition } from '../engine/tour.model';

/// Tour of a running regression session (spec 6.11, 14.4): progress, the items, take an item,
/// record a result, create a bug from a failure. Viewers get the first two. The write steps point
/// at the focused item, so they are skipped on a finished session, where nothing can be recorded.
export const REGRESSION_SESSION_TOUR: TourDefinition = {
  id: 'tour.regressions.session',
  version: 1,
  viewId: 'regressions.session',
  title: 'Regression session',
  steps: [
    {
      id: 'progress',
      anchor: 'regressions.progress',
      title: 'Progress',
      body: 'Passed, failed, skipped and waiting items, the pass rate and the bugs created so far. Automatic cases passed by themselves when the session started.',
    },
    {
      id: 'items',
      anchor: 'regressions.items',
      placement: 'end',
      title: 'Items',
      body: 'One item per test case, copied when the session started, so later edits to a case never change it. J and K move, N jumps to the next waiting item.',
    },
    {
      id: 'take',
      anchor: 'regressions.take',
      requires: 'write',
      title: 'Take an item',
      body: 'Take (I) makes the item yours; only its assignee records a result. Recording on an unassigned item takes it for you.',
    },
    {
      id: 'record',
      anchor: 'regressions.record',
      requires: 'write',
      placement: 'above',
      title: 'Record a result',
      body: 'Pass (P), Fail (F) or Skip (S). A result can be changed until the session is completed.',
    },
    {
      id: 'create-bug',
      anchor: 'regressions.create-bug',
      requires: 'write',
      placement: 'above',
      title: 'Create a bug from a failure',
      body: 'Fail asks what went wrong and offers a bug in the backlog, filled in from the test case and your note, linked to the item. A failed item without a bug keeps a Create bug button.',
    },
  ],
};
