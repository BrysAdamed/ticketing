import { inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiError, toApiError } from '@core/api/api-error';
import { safeReturnUrl } from '@core/auth/auth.guards';
import { AuthService } from '@core/auth/auth.service';
import { LoginRequest } from '@core/auth/current-user';

const MESSAGES: Record<string, string> = {
  'auth.invalidCredentials': 'Email or password is incorrect.',
  'auth.lockedOut': 'Too many failed attempts. The account is locked for 15 minutes.',
  rateLimited: 'Too many sign-in attempts. Wait a minute and try again.',
  'xsrf.invalid': 'Your session expired. Reload the page and try again.',
  network: 'Cannot reach the server. Check your connection and try again.',
};

@Injectable()
export class LoginStore {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly fieldErrors = signal<Readonly<Record<string, readonly string[]>>>({});

  async signIn(request: LoginRequest, returnUrl: string | null): Promise<void> {
    if (this.submitting()) return;
    this.submitting.set(true);
    this.error.set(null);
    this.fieldErrors.set({});
    try {
      await this.auth.login({ email: request.email.trim(), password: request.password });
      await this.router.navigateByUrl(safeReturnUrl(returnUrl));
    } catch (error) {
      const apiError = toApiError(error);
      this.fieldErrors.set(apiError.fieldErrors);
      this.error.set(messageFor(apiError));
    } finally {
      this.submitting.set(false);
    }
  }
}

function messageFor(error: ApiError): string {
  if (error.isValidation) return 'Check the highlighted fields.';
  return MESSAGES[error.code] ?? error.title;
}
