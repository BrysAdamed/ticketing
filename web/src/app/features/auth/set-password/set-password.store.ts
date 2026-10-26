import { HttpContext } from '@angular/common/http';
import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { SKIP_AUTH_REDIRECT } from '@core/api/api-error.interceptor';

/// `POST /auth/set-password/inspect`: whose link this is.
export interface SetPasswordLinkInfo {
  email: string;
  displayName: string;
  isNewUser: boolean;
  expiresAt: string;
}

export type SetPasswordPhase = 'checking' | 'invalid' | 'ready' | 'done';

const INVALID_LINK = 'user.setPasswordToken.invalid';

const quiet = () => ({ context: new HttpContext().set(SKIP_AUTH_REDIRECT, true) });

@Injectable()
export class SetPasswordStore {
  private readonly api = inject(ApiClient);
  private token: string | null = null;

  readonly phase = signal<SetPasswordPhase>('checking');
  readonly link = signal<SetPasswordLinkInfo | null>(null);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly passwordError = signal<string | null>(null);

  async load({ token }: { token: string | null }): Promise<void> {
    this.token = token?.trim() || null;
    this.error.set(null);
    if (!this.token) {
      this.phase.set('invalid');
      return;
    }
    this.phase.set('checking');
    try {
      this.link.set(
        await firstValueFrom(
          this.api.post<SetPasswordLinkInfo>(
            '/auth/set-password/inspect',
            { token: this.token },
            quiet(),
          ),
        ),
      );
      this.phase.set('ready');
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === INVALID_LINK) {
        this.phase.set('invalid');
      } else {
        this.error.set(apiError.title);
        this.phase.set('invalid');
      }
    }
  }

  async submit(password: string): Promise<void> {
    if (this.submitting() || !this.token) return;
    this.submitting.set(true);
    this.error.set(null);
    this.passwordError.set(null);
    try {
      await firstValueFrom(
        this.api.post<void>('/auth/set-password', { token: this.token, password }, quiet()),
      );
      this.phase.set('done');
    } catch (error) {
      this.handleError(toApiError(error));
    } finally {
      this.submitting.set(false);
    }
  }

  private handleError(error: ApiError): void {
    if (error.code === INVALID_LINK) {
      this.phase.set('invalid');
      return;
    }
    const field = error.fieldError('password');
    if (field) {
      this.passwordError.set(field);
      return;
    }
    this.error.set(
      error.code === 'rateLimited'
        ? 'Too many attempts. Wait a minute and try again.'
        : error.title,
    );
  }
}
