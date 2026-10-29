import { GuideRef } from '../onboarding.models';

/// A contextual hint (spec 14.5): an inline note shown where people coming from Jira are likely
/// to be confused. `requires: 'write'` hides it from users who cannot write where it is shown.
export interface HintDefinition extends GuideRef {
  readonly title: string;
  readonly body: string;
  readonly requires?: 'write';
}

/// Contextual hints (spec 14.5), ids `hint.<name>`. Append new hints here; the copy is keyed by id
/// so it can be extracted for i18n (I-60) later.
export const HINTS = [
  {
    id: 'hint.free-transitions',
    version: 1,
    title: 'No workflow to follow.',
    body: 'Any status can move to any other, and there is nothing to configure.',
    requires: 'write',
  },
  {
    id: 'hint.backlog-vs-boards',
    version: 1,
    title: 'A ticket lives in one place.',
    body: 'It is either in this backlog or on one board. Tickets on a board leave this list and are counted under "on boards" until they are sent back.',
  },
  {
    id: 'hint.private-404',
    version: 1,
    title: 'Looking for a private project?',
    body: "Projects you can't read look as if they don't exist. Ask one of its Owners to add you.",
  },
] as const satisfies readonly HintDefinition[];

export type HintId = (typeof HINTS)[number]['id'];

export function hintById(id: HintId): HintDefinition {
  return HINTS.find((hint) => hint.id === id)!;
}
