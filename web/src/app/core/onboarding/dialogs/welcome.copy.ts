/// A card of the welcome dialog. `keys` is a shortcut shown next to the title (`mod+k`), `steps`
/// a short list under the title instead of a body.
export interface WelcomeCard {
  readonly id: string;
  readonly icon: string;
  readonly title: string;
  readonly body?: string;
  readonly keys?: string;
  readonly steps?: readonly { readonly icon: string; readonly text: string }[];
}

/// Copy of the welcome dialog (spec 14.2), keyed by stable ids for i18n (I-60). Loaded with the
/// dialog, so it stays out of the initial bundle.
export const WELCOME_COPY = {
  eyebrow: 'Welcome',
  title: 'Welcome to Ticketing, {name}',
  intro:
    'Three things that work differently from Jira. Take a short tour, or tick off your first steps as you go.',
  adminIntro: 'You are an Admin of this instance. Set it up, then learn the basics.',
  note: 'Reopen any time from Help',
  close: 'Close',
  tour: 'Take the tour',
  checklist: 'Show me the checklist',
} as const;

export const WELCOME_CARDS = {
  setup: {
    id: 'setup',
    icon: 'tablerRocket',
    title: 'Set up your instance',
    steps: [
      { icon: 'tablerUsers', text: 'Add teammates and hand them set-password links' },
      { icon: 'tablerList', text: 'Create the first project' },
      { icon: 'tablerFlag', text: 'Review feature flags and set TICKETING_PUBLIC_URL' },
    ],
  },
  projects: {
    id: 'projects',
    icon: 'tablerList',
    title: 'Projects & backlog',
    body: "Every ticket starts in its project's backlog. Statuses are free: any status can move to any other.",
  },
  boards: {
    id: 'boards',
    icon: 'tablerLayoutKanban',
    title: 'Boards',
    body: 'Plan on boards that pull tickets from several projects. A ticket is in its backlog or on one board.',
  },
  find: {
    id: 'find',
    icon: 'tablerSearch',
    title: 'Find anything',
    keys: 'mod+k',
    body: 'Jump to a ticket by key, search titles and docs, run any command.',
  },
} as const satisfies Record<string, WelcomeCard>;

/// The cards for a user: Admins get "Set up your instance" first instead of Projects & backlog.
export function welcomeCards(isAdmin: boolean): readonly WelcomeCard[] {
  const { setup, projects, boards, find } = WELCOME_CARDS;
  return isAdmin ? [setup, boards, find] : [projects, boards, find];
}
