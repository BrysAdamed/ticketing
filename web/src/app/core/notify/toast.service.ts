import { ComponentType } from '@angular/cdk/portal';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../api/api-error';
import { ToastAction, ToastComponent, ToastData, ToastIntent } from './toast.component';

export interface ToastOptions {
  intent?: ToastIntent;
  action?: ToastAction;
  /// Several actions, shown in order (for example "Copy prompt" and "Help"); `action` is the one-action shorthand.
  actions?: readonly ToastAction[];
  durationMs?: number;
}

/// Bottom-right toasts (Material snack bar with our template). One toast at a time; a new one
/// replaces the current one. Toasts nobody asked for (achievement unlocks) wait for `whenIdle()`
/// so they never replace one the user is reading, such as an Undo.
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);
  private current: MatSnackBarRef<unknown> | null = null;

  show(message: string, options: ToastOptions = {}): MatSnackBarRef<ToastComponent> {
    const actions = options.actions ?? (options.action ? [options.action] : []);
    const data: ToastData = { message, intent: options.intent ?? 'info', actions };
    return this.track(
      this.snackBar.openFromComponent(ToastComponent, {
        data,
        duration: options.durationMs ?? (actions.length ? 8000 : 5000),
        horizontalPosition: 'end',
        verticalPosition: 'bottom',
        politeness: options.intent === 'danger' ? 'assertive' : 'polite',
      }),
    );
  }

  /// Opens a custom toast component in the same place as the others; `data` reaches it as
  /// `MAT_SNACK_BAR_DATA`. Without `durationMs` it stays until the component dismisses itself.
  showComponent<T, D>(
    component: ComponentType<T>,
    data: D,
    options: { durationMs?: number } = {},
  ): MatSnackBarRef<T> {
    return this.track(
      this.snackBar.openFromComponent(component, {
        data,
        duration: options.durationMs,
        horizontalPosition: 'end',
        verticalPosition: 'bottom',
        politeness: 'polite',
      }),
    );
  }

  /// Resolves once no toast is open (at once when none is).
  async whenIdle(): Promise<void> {
    while (this.current) await firstValueFrom(this.current.afterDismissed());
  }

  success(message: string, options: Omit<ToastOptions, 'intent'> = {}) {
    return this.show(message, { ...options, intent: 'success' });
  }

  warning(message: string, options: Omit<ToastOptions, 'intent'> = {}) {
    return this.show(message, { ...options, intent: 'warning' });
  }

  error(error: unknown, options: Omit<ToastOptions, 'intent'> = {}) {
    const message = typeof error === 'string' ? error : toApiError(error).title;
    return this.show(message, { ...options, intent: 'danger' });
  }

  private track<T>(ref: MatSnackBarRef<T>): MatSnackBarRef<T> {
    this.current = ref;
    ref.afterDismissed().subscribe(() => {
      if (this.current === ref) this.current = null;
    });
    return ref;
  }
}
