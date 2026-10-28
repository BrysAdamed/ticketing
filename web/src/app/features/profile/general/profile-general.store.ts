import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { AvatarDirectory } from '@core/users/avatar-directory';
import { UserAvatar } from '@shared/avatars/avatar-catalog';

export type FieldErrors = Readonly<Record<string, string | null>>;

@Injectable()
export class ProfileGeneralStore {
  private readonly api = inject(ApiClient);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private readonly avatars = inject(AvatarDirectory);
  private avatarSaves = 0;

  readonly user = this.auth.currentUser;
  readonly savingName = signal(false);
  readonly nameError = signal<string | null>(null);
  readonly changingPassword = signal(false);
  readonly passwordErrors = signal<FieldErrors>({});
  readonly avatar = computed(() => {
    const user = this.user();
    return user ? this.avatars.avatarOf(user.id) : null;
  });
  readonly avatarArtReady = this.avatars.artReady;

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

  loadAvatarArt(): void {
    void this.avatars.ensureArt();
  }

  imageOf(icon: string): string | null {
    return this.avatars.imageOf(icon);
  }

  /// Shows the avatar at once and saves it; a failed save rolls back unless a later pick followed.
  async saveAvatar(next: UserAvatar): Promise<void> {
    const user = this.user();
    if (!user) return;
    const previous = this.avatars.avatarOf(user.id);
    const save = ++this.avatarSaves;
    this.avatars.set(user.id, next);
    try {
      await firstValueFrom(
        this.api.patch('/me', { avatarIcon: next.icon, avatarColor: next.color }),
      );
      if (save === this.avatarSaves) this.toast.success('Avatar saved.');
    } catch (error) {
      if (save === this.avatarSaves) this.avatars.set(user.id, previous);
      this.toast.error(error);
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
