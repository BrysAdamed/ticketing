import { HINTS } from './guides/hints';
import { WELCOME_GUIDE } from './guides/welcome';
import { WHATS_NEW_ENTRIES } from './guides/whats-new';
import { GuideRef } from './onboarding.models';

/// Every guide that can appear without the user asking for it (the welcome dialog, What's new
/// entries and inline hints) at its current version. The e2e suites import this list to mark
/// these guides seen for the users they sign in (TKT-77), so a guide that shows by itself must be
/// listed in one of the data files above. Plain TypeScript: no Angular imports here or there.
export const AUTO_SHOWN_GUIDES: readonly GuideRef[] = [
  WELCOME_GUIDE,
  ...WHATS_NEW_ENTRIES,
  ...HINTS,
];
