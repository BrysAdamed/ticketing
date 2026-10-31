import { FlagKey } from '../../flags/flag-keys';
import { GuideRef } from '../onboarding.models';

/// One highlight of a What's new entry. `flag` hides it while that feature flag is off for the user.
export interface WhatsNewItem {
  readonly title: string;
  readonly body: string;
  readonly flag?: FlagKey;
}

/// A What's new entry (spec 14.2): id `whats-new.<date>`, `date` as `yyyy-mm`. An entry whose month
/// starts before the user's account was created counts as seen.
export interface WhatsNewEntry extends GuideRef {
  readonly date: string;
  readonly title: string;
  readonly items: readonly WhatsNewItem[];
}

/// What's new entries, oldest first. Append new entries; the e2e guard picks them up through
/// `AUTO_SHOWN_GUIDES`. Plain TypeScript: no Angular imports.
export const WHATS_NEW_ENTRIES: readonly WhatsNewEntry[] = [
  {
    id: 'whats-new.2026-11',
    version: 1,
    date: '2026-11',
    title: 'Notifications, Docs and more',
    items: [
      {
        title: 'Notifications',
        body: 'The bell in the top bar lists assignments, mentions and changes to tickets you watch. G then N opens it.',
      },
      {
        title: 'Watchers',
        body: 'Watch a ticket with W to hear about its comments, status changes and moves. Reporting, being assigned, commenting or being mentioned watches it for you.',
      },
      {
        title: '@mentions',
        body: 'Type @ in a description or comment to mention someone who can read the project. They start watching and get notified.',
      },
      {
        title: 'Sub-tickets graph',
        body: "Switch a ticket's sub-tickets to a graph: which children block each other, which are ready, and the critical path.",
        flag: 'ticket.subtickets-graph',
      },
      {
        title: 'Docs',
        body: 'Every project has docs: pages and diagrams in a tree, with history, comments and links to tickets. G then W opens them.',
      },
      {
        title: 'Delegate to agent',
        body: 'Hand a ticket to Claude Code from its header: Ticketing writes the prompt and opens it in your agent.',
        flag: 'agent.delegate',
      },
    ],
  },
];
