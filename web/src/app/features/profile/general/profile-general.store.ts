import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AchievementsAccess } from '@core/achievements/achievements-access';
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
  private readonly access = inject(AchievementsAccess);
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
  readonly achievementsAvailable = this.access.flagOn;
  readonly achievementsOn = this.access.enabled;
  readonly confirmingOptOut = signal(false);
  readonly savingAchievements = signal(false);

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

  /// The switch: turning off asks first (the opt-out deletes the data), turning on saves at once.
  toggleAchievements(): void {
    if (this.savingAchievements()) return;
    if (this.achievementsOn()) this.confirmingOptOut.update((open) => !open);
    else void this.saveAchievements(false);
  }

  cancelOptOut(): void {
    this.confirmingOptOut.set(false);
  }

  confirmOptOut(): Promise<void> {
    return this.saveAchievements(true);
  }

  /// Optimistic: every achievements surface hides or returns at once and rolls back on failure. The
  /// choice is applied again once saved, because a poll answered before the save can contradict it.
  private async saveAchievements(hidden: boolean): Promise<void> {
    this.confirmingOptOut.set(false);
    this.savingAchievements.set(true);
    this.markAchievements(hidden);
    try {
      await firstValueFrom(this.api.patch('/me', { achievementsHidden: hidden }));
      this.markAchievements(hidden);
      this.toast.success(
        hidden
          ? 'Achievements turned off. Your achievements were deleted.'
          : 'Achievements turned on. Counting starts now.',
      );
    } catch (error) {
      this.markAchievements(!hidden);
      this.toast.error(error);
    } finally {
      this.savingAchievements.set(false);
    }
  }

  private markAchievements(hidden: boolean): void {
    if (hidden) this.access.markDisabled();
    else this.access.markEnabled();
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
