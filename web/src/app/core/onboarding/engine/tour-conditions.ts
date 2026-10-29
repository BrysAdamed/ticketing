import type { Observable } from 'rxjs';

/// Whether a named condition holds, and the params it learnt on the way (the new project's key, the
/// ticket's key), which later steps' routes and copy use.
export interface TourConditionResult {
  readonly holds: boolean;
  readonly params?: Readonly<Record<string, string>>;
}

/// What an action-driven tour needs from the code that starts it (D-142): conditions over real data
/// for `advanceWhen: { kind: 'condition' }`, the custom step actions, and when to check again.
export interface TourConditions {
  /// Reads the real state; never throws (a failed read is "does not hold").
  check(id: string, params: Readonly<Record<string, string>>): Promise<TourConditionResult>;
  /// Runs a `custom` step action (for example opening a dialog with suggestions) and resolves
  /// the params it learnt, or null when the user cancelled.
  run(id: string, params: Readonly<Record<string, string>>): Promise<Record<string, string> | null>;
  /// Emits when the state may have changed (a write succeeded, the window got focus). Navigation
  /// and closing dialogs are watched by the engine itself.
  readonly changes: Observable<unknown>;
}
