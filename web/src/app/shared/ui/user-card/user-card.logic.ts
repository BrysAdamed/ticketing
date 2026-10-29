import {
  medalLabel,
  sharedTierCount,
  tierText,
} from '../achievement-medal/achievement-medal.logic';

/// One shared achievement as `GET /users/{id}/achievements` returns it: no dates or counts.
export interface SharedMedal {
  id: string;
  name: string;
  icon: string;
  tier: number;
}

/// Where the card's achievements stand: `off` while the viewer's achievements UI is disabled (no
/// request is made), `hidden` for a 404 or any failure, so the card never says why.
export type SharedMedalsState =
  | { status: 'off' }
  | { status: 'loading' }
  | { status: 'hidden' }
  | { status: 'loaded'; items: readonly SharedMedal[] };

export interface SharedMedalView extends SharedMedal {
  tierCount: number;
  tierText: string;
  label: string;
}

export interface UserCardSection {
  heading: 'Shared achievements' | 'Shared by you';
  items: SharedMedalView[];
}

export function sharedMedalView(medal: SharedMedal): SharedMedalView {
  const tierCount = sharedTierCount(medal.id);
  return {
    ...medal,
    tierCount,
    tierText: tierText({ tier: medal.tier, tierCount }),
    label: medalLabel({
      name: medal.name,
      tier: medal.tier,
      tierCount,
      secret: false,
      masked: false,
    }),
  };
}

/// The "Shared achievements" section, in the order the API returns (catalogue order, never by
/// tier), or null when there is nothing to show: achievements off, hidden, still loading or
/// nothing shared.
export function userCardSection(state: SharedMedalsState, self: boolean): UserCardSection | null {
  if (state.status !== 'loaded' || state.items.length === 0) return null;
  return {
    heading: self ? 'Shared by you' : 'Shared achievements',
    items: state.items.map(sharedMedalView),
  };
}

/// Your own card links to Profile → Achievements once your shares loaded, shared or not; not while
/// achievements are off for you or you opted out (the read answers 404).
export function showManageLink(state: SharedMedalsState, self: boolean): boolean {
  return self && state.status === 'loaded';
}
