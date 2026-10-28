import { GuideRef, OnboardingChecklistItem } from '../onboarding.models';

/// The getting-started checklist card (spec 14.3, D-133). Raising the version shows the card again
/// to everyone who dismissed or completed it.
export const CHECKLIST_GUIDE: GuideRef = { id: 'checklist', version: 1 };

export type ChecklistGroupId = 'start' | 'projects' | 'instance' | 'agent';

export interface ChecklistGroupCopy {
  id: ChecklistGroupId;
  /// Group heading; the first group has none.
  label: string | null;
  optional: boolean;
}

export const CHECKLIST_GROUPS: readonly ChecklistGroupCopy[] = [
  { id: 'start', label: null, optional: false },
  { id: 'projects', label: 'Your projects', optional: false },
  { id: 'instance', label: 'Your instance', optional: false },
  { id: 'agent', label: 'Connect an AI agent', optional: true },
];

export interface ChecklistItemCopy {
  label: string;
  group: ChecklistGroupId;
  /// What to do next, shown on the first open item.
  hint: string;
}

/// Labels for the item ids the server computes (`OnboardingChecklistItems`). Ids the client does
/// not know yet are left out, so the server can add items before the web app ships their copy.
export const CHECKLIST_COPY: Readonly<Record<string, ChecklistItemCopy>> = {
  'create-ticket': { label: 'Create a ticket', group: 'start', hint: 'Press C' },
  'move-work': { label: 'Move work forward', group: 'start', hint: 'Change a status' },
  'join-conversation': { label: 'Join the conversation', group: 'start', hint: 'Open a ticket' },
  'follow-ticket': { label: 'Follow a ticket', group: 'start', hint: 'Press W on a ticket' },
  'invite-team': { label: 'Invite your team', group: 'projects', hint: 'Add members' },
  'plan-on-board': { label: 'Plan on a board', group: 'projects', hint: 'Create a board' },
  'write-test-case': { label: 'Write a test case', group: 'projects', hint: 'Open test cases' },
  'run-regression': { label: 'Run a regression', group: 'projects', hint: 'Start a session' },
  'add-teammate': { label: 'Add a teammate', group: 'instance', hint: 'Open users' },
  'first-project': { label: 'Create the first project', group: 'instance', hint: 'Open projects' },
  'enable-delegation': {
    label: 'Enable agent delegation',
    group: 'instance',
    hint: 'Set TICKETING_PUBLIC_URL',
  },
  'agent-token': { label: 'Create a token', group: 'agent', hint: 'Open access tokens' },
  'agent-connected': {
    label: 'Confirm the connection',
    group: 'agent',
    hint: 'Use the token once',
  },
};

/// The items whose action needs write access; the server leaves them out for users who cannot write anywhere.
export const WRITE_ITEMS: readonly string[] = ['create-ticket', 'move-work', 'join-conversation'];

export interface ChecklistEntry extends OnboardingChecklistItem {
  copy: ChecklistItemCopy;
}

export interface ChecklistGroup extends ChecklistGroupCopy {
  entries: ChecklistEntry[];
}

export interface ChecklistProgress {
  done: number;
  total: number;
  /// Every required item is done (optional items never hold completion back).
  complete: boolean;
}

/// Items with known copy, grouped in display order; empty groups are left out.
export function groupChecklist(items: readonly OnboardingChecklistItem[]): ChecklistGroup[] {
  const known = items.flatMap((item) => {
    const copy = CHECKLIST_COPY[item.id];
    return copy ? [{ ...item, copy }] : [];
  });
  return CHECKLIST_GROUPS.map((group) => ({
    ...group,
    entries: known.filter((entry) => entry.copy.group === group.id),
  })).filter((group) => group.entries.length > 0);
}

export function checklistProgress(items: readonly OnboardingChecklistItem[]): ChecklistProgress {
  const required = items.filter((item) => !item.optional && CHECKLIST_COPY[item.id]);
  const done = required.filter((item) => item.done).length;
  return {
    done,
    total: required.length,
    complete: required.length > 0 && done === required.length,
  };
}

/// The first open required item, highlighted as the next step; null when all are done.
export function nextChecklistItem(items: readonly OnboardingChecklistItem[]): string | null {
  return items.find((item) => !item.optional && !item.done && CHECKLIST_COPY[item.id])?.id ?? null;
}

export function canWriteSomewhere(items: readonly OnboardingChecklistItem[]): boolean {
  return items.some((item) => WRITE_ITEMS.includes(item.id));
}
