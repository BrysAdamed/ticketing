import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, Subject } from 'rxjs';
import { AchievementsAccess } from '@core/achievements/achievements-access';
import { ApiClient } from '@core/api/api-client';
import { ApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { CurrentUser } from '@core/auth/current-user';
import { FeatureFlagService } from '@core/flags/feature-flag.service';
import { ToastService } from '@core/notify/toast.service';
import { AvatarDirectory } from '@core/users/avatar-directory';
import { ProfileGeneralStore } from './profile-general.store';

class FakeApi {
  pending = new Subject<unknown>();
  patch = vi.fn((): Observable<unknown> => this.pending);

  succeed(): void {
    this.pending.next({});
    this.pending.complete();
  }

  fail(): void {
    this.pending.error(new ApiError(500, 'server.error', 'Boom'));
  }
}

describe('ProfileGeneralStore achievements opt-out', () => {
  let api: FakeApi;
  let flags: Record<string, string>;
  let user: ReturnType<typeof signal<CurrentUser | null>>;
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  function setup(): { store: ProfileGeneralStore; access: AchievementsAccess } {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        ProfileGeneralStore,
        { provide: ApiClient, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: AvatarDirectory, useValue: { avatarOf: () => null, artReady: signal(true) } },
        { provide: FeatureFlagService, useValue: { isOn: (key: string) => flags[key] === 'on' } },
        { provide: AuthService, useValue: { currentUser: user } },
      ],
    });
    return {
      store: TestBed.inject(ProfileGeneralStore),
      access: TestBed.inject(AchievementsAccess),
    };
  }

  beforeEach(() => {
    api = new FakeApi();
    flags = { achievements: 'on' };
    user = signal<CurrentUser | null>({
      id: 'user-1',
      email: 'jane@example.com',
      displayName: 'Jane',
      globalRole: 'User',
      achievementsHidden: false,
    });
    toast = { success: vi.fn(), error: vi.fn() };
  });

  it('is unavailable while the flag is off', () => {
    // Arrange
    flags = {};

    // Act
    const { store } = setup();

    // Assert
    expect(store.achievementsAvailable()).toBe(false);
  });

  it('starts off for a user who opted out according to /me', () => {
    // Arrange
    user.set({ ...user()!, achievementsHidden: true });

    // Act
    const { store } = setup();

    // Assert
    expect(store.achievementsAvailable()).toBe(true);
    expect(store.achievementsOn()).toBe(false);
  });

  it('asks before turning off and saves nothing when the user keeps them', () => {
    // Arrange
    const { store } = setup();

    // Act
    store.toggleAchievements();
    const asked = store.confirmingOptOut();
    store.cancelOptOut();

    // Assert
    expect(asked).toBe(true);
    expect(store.confirmingOptOut()).toBe(false);
    expect(store.achievementsOn()).toBe(true);
    expect(api.patch).not.toHaveBeenCalled();
  });

  it('turns off optimistically on confirm and hides achievements everywhere', async () => {
    // Arrange
    const { store, access } = setup();
    store.toggleAchievements();

    // Act
    const saving = store.confirmOptOut();
    const during = access.enabled();
    api.succeed();
    await saving;

    // Assert
    expect(api.patch).toHaveBeenCalledWith('/me', { achievementsHidden: true });
    expect(during).toBe(false);
    expect(access.enabled()).toBe(false);
    expect(store.confirmingOptOut()).toBe(false);
    expect(store.savingAchievements()).toBe(false);
    expect(toast.success).toHaveBeenCalled();
  });

  it('rolls the opt-out back when the save fails', async () => {
    // Arrange
    const { store, access } = setup();
    store.toggleAchievements();

    // Act
    const saving = store.confirmOptOut();
    api.fail();
    await saving;

    // Assert
    expect(access.enabled()).toBe(true);
    expect(toast.error).toHaveBeenCalled();
  });

  it('turns back on without a confirm', async () => {
    // Arrange
    user.set({ ...user()!, achievementsHidden: true });
    const { store, access } = setup();

    // Act
    store.toggleAchievements();
    const during = access.enabled();
    api.succeed();
    await vi.waitFor(() => expect(store.savingAchievements()).toBe(false));

    // Assert
    expect(store.confirmingOptOut()).toBe(false);
    expect(api.patch).toHaveBeenCalledWith('/me', { achievementsHidden: false });
    expect(during).toBe(true);
    expect(access.enabled()).toBe(true);
  });

  it('rolls the opt-in back when the save fails', async () => {
    // Arrange
    user.set({ ...user()!, achievementsHidden: true });
    const { store, access } = setup();

    // Act
    store.toggleAchievements();
    api.fail();
    await vi.waitFor(() => expect(store.savingAchievements()).toBe(false));

    // Assert
    expect(access.enabled()).toBe(false);
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores the switch while a save is in flight', () => {
    // Arrange
    user.set({ ...user()!, achievementsHidden: true });
    const { store } = setup();
    store.toggleAchievements();

    // Act
    store.toggleAchievements();

    // Assert
    expect(api.patch).toHaveBeenCalledTimes(1);
  });
});
