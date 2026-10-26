import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';

export type FieldErrors = Readonly<Record<string, string | null>>;

@Injectable()
export class ProfileGeneralStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  readonly user = this.auth.currentUser;
  readonly savingName = signal(false);
  readonly nameError = signal<string | null>(null);
  readonly changingPassword = signal(false);
  readonly passwordErrors = signal<FieldErrors>({});

  async saveDisplayName(displayName: string): Promise<boolean> {
    if (this.savingName()) return false;
    this.savingName.set(true);
    this.nameError.set(null);
    try {
      await firstValueFrom(this.api.patch('/me', { displayName: displayName.trim() }));
      await this.auth.refreshUser();
      this.toast.success('Display name saved.');
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      this.nameError.set(apiError.fieldError('displayName') ?? apiError.title);
      return false;
    } finally {
      this.savingName.set(false);
    }
  }

  /// Other sessions of the user end; this one is re-issued by the server and continues.
  async changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
    if (this.changingPassword()) return false;
    this.changingPassword.set(true);
    this.passwordErrors.set({});
    try {
      await firstValueFrom(this.api.post('/me/password', { currentPassword, newPassword }));
      this.toast.success('Password changed. Your other sessions were signed out.');
      return true;
    } catch (error) {
      const apiError = toApiError(error);
      const current = apiError.fieldError('currentPassword');
      const next = apiError.fieldError('newPassword');
      this.passwordErrors.set({
        currentPassword: current,
        newPassword: next,
        form: current || next ? null : apiError.title,
      });
      return false;
    } finally {
      this.changingPassword.set(false);
    }
  }
}
