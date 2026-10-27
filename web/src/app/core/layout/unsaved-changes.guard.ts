import { CanDeactivateFn } from '@angular/router';

/// A routed view that may hold unsaved changes. `confirmLeave` resolves true when the user may
/// leave (nothing unsaved, or they agreed to discard it).
export interface LeaveGuarded {
  confirmLeave(): boolean | Promise<boolean>;
}

/// `canDeactivate` guard asking the view whether unsaved changes may be dropped.
export const unsavedChangesGuard: CanDeactivateFn<LeaveGuarded> = (component) =>
  component?.confirmLeave ? component.confirmLeave() : true;
