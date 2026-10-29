/// What a step needs from the user's role: `write` (Owner or Member of a non-archived project),
/// `owner` (project Owner) or `admin` (instance Admin). Steps without it are shown to everyone.
export type TourRequirement = 'write' | 'owner' | 'admin';

/// One step of a guided tour. Pure data (no Angular imports) so e2e specs can import tours.
export interface TourStep {
  /// Stable id, unique within the tour (copy keys and analytics later).
  readonly id: string;
  /// Tour anchor id exposed with `tkTourAnchor` by every variant of the view (D-131).
  readonly anchor: string;
  readonly title: string;
  readonly body: string;
  readonly requires?: TourRequirement;
  /// Preferred side of the anchor; the popover flips or pushes when it does not fit.
  readonly placement?: TourPlacement;
  /// Route the step lives on, with `:param` placeholders filled from the tour's params
  /// (`/projects/:projectKey/backlog`). The engine navigates there before showing the step.
  readonly route?: string;
  /// Makes the step action-driven (TKT-80): it has no Next and moves on when the user really does
  /// the action, however it was done. Such a step is non-modal: no backdrop, a click-through hole
  /// and live shortcuts.
  readonly advanceWhen?: TourAdvance;
  /// An action-driven step the user may skip ("Skip this step").
  readonly optional?: boolean;
  /// The step's own button, for doing the action from the keyboard.
  readonly action?: TourStepAction;
  /// Steps sharing a stage count as one in "Step n of m" (a walkthrough that embeds a view's tour).
  readonly stage?: string;
  /// Shown while an action-driven step waits ("Waiting for you to create the project").
  readonly waiting?: string;
}

/// When an action-driven step is done: the user is on `path` (`:param` placeholders filled from the
/// tour's params), or the named condition holds. Conditions are resolved by the code that starts the
/// tour (`TourConditions`), so tours stay plain data.
export type TourAdvance =
  | { readonly kind: 'route'; readonly path: string }
  | { readonly kind: 'condition'; readonly id: string };

/// `click-anchor` and `focus-anchor` act on the step's anchor; `custom` runs `TourConditions.run`.
export type TourStepAction =
  | { readonly label: string; readonly does: 'click-anchor' }
  | { readonly label: string; readonly does: 'focus-anchor' }
  | { readonly label: string; readonly does: 'custom'; readonly id: string };

export type TourPlacement = 'below' | 'above' | 'start' | 'end';

/// A guided tour of one view, keyed by view id rather than variant (D-131).
export interface TourDefinition {
  /// Guide id stored in the onboarding state (`tour.backlog.list`, `GUIDE_ID_PATTERN`).
  readonly id: string;
  /// Raising it shows the tour again to users who completed an older version.
  readonly version: number;
  readonly viewId: string;
  readonly title: string;
  /// `walkthrough` spans several views (TKT-80): navigating away pauses it instead of ending it,
  /// and its card reads "Your first project · Step 1 of 7".
  readonly kind?: 'tour' | 'walkthrough';
  readonly steps: readonly TourStep[];
}

/// What the current user may do where the tour runs; decides which `requires` steps are shown.
export interface TourAccess {
  readonly canWrite: boolean;
  readonly isOwner: boolean;
  readonly isAdmin: boolean;
}
