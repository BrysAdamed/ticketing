export type GuideState = 'Completed' | 'Dismissed';

/// The version of a guide the user completed or dismissed.
export interface GuideProgress {
  guideId: string;
  version: number;
  state: GuideState;
  updatedAt: string;
}

/// One getting-started step, computed on the server from real data.
export interface OnboardingChecklistItem {
  id: string;
  done: boolean;
  optional: boolean;
}

/// `GET /me/onboarding`.
export interface Onboarding {
  checklist: OnboardingChecklistItem[];
  guides: GuideProgress[];
  ownsProjects: boolean;
  createdAt: string;
}

/// Guide ids are authored in code: lower-case words joined by `-`, in segments separated by `.`
/// (`welcome`, `tour.backlog`, `whats-new.2026-11`), at most 100 characters. The server rejects
/// anything else with `onboarding.guide.invalid`.
export const GUIDE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*(?:\.[a-z0-9]+(?:-[a-z0-9]+)*)*$/;
export const GUIDE_ID_MAX_LENGTH = 100;
