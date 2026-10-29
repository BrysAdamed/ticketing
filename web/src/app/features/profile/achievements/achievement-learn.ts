import { MyAchievement } from '@core/achievements/achievement.models';
import { CONNECT_AGENT_HELP_ID } from '@core/onboarding/agent/connect-agent';
import { LearnActions } from '@core/onboarding/learn-actions';

/// What "Show me" starts: a per-view tour, the "Your first project" walkthrough or a Help item.
export type AchievementLearnTarget =
  | { readonly kind: 'tour'; readonly viewId: string }
  | { readonly kind: 'walkthrough'; readonly skipOptional?: boolean }
  | { readonly kind: 'help'; readonly itemId: string };

export interface AchievementLearnAction {
  readonly target: AchievementLearnTarget;
  /// One muted sentence next to the button saying what it starts.
  readonly note: string;
}

const BACKLOG_TOUR: AchievementLearnTarget = { kind: 'tour', viewId: 'backlog.list' };

/// The learn action of each catalogue entry that has one (spec 15.9, D-154). Only actions that can
/// start from the Achievements tab are listed: tours with a path, the walkthrough and Help items.
/// Secret entries never appear here.
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
    'test-author',
    {
      target: { kind: 'tour', viewId: 'testcases.list' },
      note: 'Starts the test cases tour, which begins at Write a test case.',
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

/// Whether the target can start right now (D-143: hidden while nothing can start); reactive.
export function canStartLearn(learn: LearnActions, target: AchievementLearnTarget): boolean {
  switch (target.kind) {
    case 'tour':
      return learn.canStartTour(target.viewId);
    case 'walkthrough':
      return learn.canStartWalkthrough();
    case 'help':
      return learn.canRunHelpItem(target.itemId);
  }
}

export function startLearn(learn: LearnActions, target: AchievementLearnTarget): void {
  switch (target.kind) {
    case 'tour':
      void learn.startTour(target.viewId);
      return;
    case 'walkthrough':
      learn.startWalkthrough({ skipOptional: target.skipOptional });
      return;
    case 'help':
      learn.runHelpItem(target.itemId);
      return;
  }
}
