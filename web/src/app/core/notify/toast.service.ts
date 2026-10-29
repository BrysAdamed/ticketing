import { ComponentType } from '@angular/cdk/portal';
import { inject, Injectable } from '@angular/core';
import { MatSnackBar, MatSnackBarRef } from '@angular/material/snack-bar';
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
/// replaces the current one.
@Injectable({ providedIn: 'root' })
export class ToastService {
  private readonly snackBar = inject(MatSnackBar);

  show(message: string, options: ToastOptions = {}): MatSnackBarRef<ToastComponent> {
    const actions = options.actions ?? (options.action ? [options.action] : []);
    const data: ToastData = { message, intent: options.intent ?? 'info', actions };
    return this.snackBar.openFromComponent(ToastComponent, {
      data,
      duration: options.durationMs ?? (actions.length ? 8000 : 5000),
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      politeness: options.intent === 'danger' ? 'assertive' : 'polite',
    });
  }

  /// Opens a custom toast component in the same place as the others; `data` reaches it as
  /// `MAT_SNACK_BAR_DATA`. Without `durationMs` it stays until the component dismisses itself.
  showComponent<T, D>(
    component: ComponentType<T>,
    data: D,
    options: { durationMs?: number } = {},
  ): MatSnackBarRef<T> {
    return this.snackBar.openFromComponent(component, {
      data,
      duration: options.durationMs,
      horizontalPosition: 'end',
      verticalPosition: 'bottom',
      politeness: 'polite',
    });
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
}
