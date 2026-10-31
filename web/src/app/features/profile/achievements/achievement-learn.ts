import { MyAchievement } from '@core/achievements/achievement.models';
import { CONNECT_AGENT_HELP_ID } from '@core/onboarding/agent/connect-agent';
import { LearnActions } from '@core/onboarding/learn-actions';

/// What "Show me" starts: a per-view tour (at a given step), the "Your first project" walkthrough,
/// a Help item or the regressions explainer.
export type AchievementLearnTarget =
  | { readonly kind: 'tour'; readonly viewId: string; readonly step?: string }
  | { readonly kind: 'walkthrough'; readonly skipOptional?: boolean }
  | { readonly kind: 'help'; readonly itemId: string }
  | { readonly kind: 'regressions-explainer' };

export interface AchievementLearnAction {
  readonly target: AchievementLearnTarget;
  /// One muted sentence next to the button saying what it starts.
  readonly note: string;
}

const BACKLOG_TOUR: AchievementLearnTarget = { kind: 'tour', viewId: 'backlog.list' };
const ticketTour = (step: string): AchievementLearnTarget => ({
  kind: 'tour',
  viewId: 'ticket.detail',
  step,
});
const sessionTour = (step: string): AchievementLearnTarget => ({
  kind: 'tour',
  viewId: 'regressions.session',
  step,
});

/// The learn action of each catalogue entry that has one (spec 15.9, D-154, D-170). Tours with a
/// path start in a project; the ticket, board and regression-session tours first open one the user
/// can read. Show me (attachments) and Epic finisher have no matching tour step. Secret entries
/// never appear here.
export const ACHIEVEMENT_LEARN_ACTIONS: ReadonlyMap<string, AchievementLearnAction> = new Map([
  [
    'reporter',
    { target: BACKLOG_TOUR, note: 'Starts the backlog tour, which begins at Create a ticket.' },
  ],
  [
    'bug-hunter',
    {
      target: BACKLOG_TOUR,
      note: 'Starts the backlog tour, which begins at Create a ticket; pick the type Bug.',
    },
  ],
  [
    'closer',
    {
      target: BACKLOG_TOUR,
      note: 'Starts the backlog tour, which shows where to change a status.',
    },
  ],
  [
    'ready-for-review',
    {
      target: BACKLOG_TOUR,
      note: 'Starts the backlog tour, which shows where to change a status.',
    },
  ],
  [
    'exterminator',
    {
      target: BACKLOG_TOUR,
      note: 'Starts the backlog tour, which shows where to change a status.',
    },
  ],
  [
    'triage',
    {
      target: BACKLOG_TOUR,
      note: 'Starts the backlog tour, which shows where to change the assignee.',
    },
  ],
  [
    'connector',
    { target: ticketTour('links'), note: 'Opens a ticket and starts its tour at Links.' },
  ],
  [
    'conversationalist',
    {
      target: ticketTour('mentions'),
      note: 'Opens a ticket and starts its tour at the comment box.',
    },
  ],
  [
    'shout-out',
    { target: ticketTour('mentions'), note: 'Opens a ticket and starts its tour at @mentions.' },
  ],
  [
    'delegator',
    {
      target: ticketTour('delegate'),
      note: 'Opens a ticket and starts its tour at Delegate to agent, where the project allows it.',
    },
  ],
  [
    'test-author',
    {
      target: { kind: 'tour', viewId: 'testcases.list' },
      note: 'Starts the test cases tour, which begins at Write a test case.',
    },
  ],
  [
    'regression-runner',
    {
      target: sessionTour('record'),
      note: 'Opens a regression session and starts its tour at Record a result.',
    },
  ],
  [
    'found-it',
    {
      target: sessionTour('create-bug'),
      note: 'Opens a regression session and starts its tour at Create a bug from a failure.',
    },
  ],
  [
    'full-sweep',
    {
      target: { kind: 'regressions-explainer' },
      note: 'Opens How regressions work; complete a session once its items have results.',
    },
  ],
  [
    'board-builder',
    {
      target: { kind: 'walkthrough', skipOptional: true },
      note: 'Starts the “Your first project” walkthrough, which leads to Create a board.',
    },
  ],
  [
    'spring-cleaning',
    {
      target: { kind: 'tour', viewId: 'board.kanban' },
      note: 'Opens a board and starts its tour; archive a finished board from its settings.',
    },
  ],
  [
    'machine-whisperer',
    {
      target: { kind: 'help', itemId: CONNECT_AGENT_HELP_ID },
      note: 'Opens the Connect an AI agent guide.',
    },
  ],
]);

/// The learn action of a locked, non-secret achievement, or null: earned, masked and secret
/// entries get none, and so do entries without a matching tour or guide.
export function learnActionFor(item: MyAchievement): AchievementLearnAction | null {
  if (item.masked || item.secret || item.tier > 0 || !item.id) return null;
  return ACHIEVEMENT_LEARN_ACTIONS.get(item.id) ?? null;
}

/// Looks up what the target opens before it starts (a ticket, a board or a session, D-170); call it
/// when the action is shown, so `canStartLearn` can turn true.
export function prepareLearn(learn: LearnActions, target: AchievementLearnTarget): void {
  if (target.kind === 'tour') learn.prepareTour(target.viewId);
}

/// Whether the target can start right now (D-143: hidden while nothing can start); reactive.
export function canStartLearn(learn: LearnActions, target: AchievementLearnTarget): boolean {
  switch (target.kind) {
    case 'tour':
      return learn.canStartTour(target.viewId);
    case 'walkthrough':
      return learn.canStartWalkthrough();
    case 'help':
      return learn.canRunHelpItem(target.itemId);
    case 'regressions-explainer':
      return true;
  }
}

export function startLearn(learn: LearnActions, target: AchievementLearnTarget): void {
  switch (target.kind) {
    case 'tour':
      void learn.startTour(target.viewId, { step: target.step });
      return;
    case 'walkthrough':
      learn.startWalkthrough({ skipOptional: target.skipOptional });
      return;
    case 'help':
      learn.runHelpItem(target.itemId);
      return;
    case 'regressions-explainer':
      void learn.openRegressionsExplainer();
      return;
  }
}
