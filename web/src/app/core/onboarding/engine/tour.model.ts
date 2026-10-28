/// What a step needs from the user's role: `write` (Owner or Member of a non-archived project),
/// `owner` (project Owner) or `admin` (instance Admin). Steps without it are shown to everyone.
export type TourRequirement = 'write' | 'owner' | 'admin';

/// One step of a guided tour. Pure data (no Angular imports) so e2e specs can import tours.
export interface TourStep {
  /// Stable id, unique within the tour (copy keys and analytics later).
  readonly id: string;
  /// Tour anchor id exposed with `tkTourAnchor` by every variant of the view (D-129).
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
  readonly requires?: TourRequirement;
  /// Preferred side of the anchor; the popover flips or pushes when it does not fit.
  readonly placement?: TourPlacement;
  /// Route the step lives on, with `:param` placeholders filled from the tour's params
  /// (`/projects/:projectKey/backlog`). The engine navigates there before showing the step.
  readonly route?: string;
}

export type TourPlacement = 'below' | 'above' | 'start' | 'end';

/// A guided tour of one view, keyed by view id rather than variant (D-129).
export interface TourDefinition {
  /// Guide id stored in the onboarding state (`tour.backlog`).
  readonly id: string;
  /// Raising it shows the tour again to users who completed an older version.
  readonly version: number;
  readonly viewId: string;
  readonly title: string;
  readonly steps: readonly TourStep[];
}

/// What the current user may do where the tour runs; decides which `requires` steps are shown.
export interface TourAccess {
  readonly canWrite: boolean;
  readonly isOwner: boolean;
  readonly isAdmin: boolean;
}
