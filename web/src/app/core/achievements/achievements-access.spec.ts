import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../auth/auth.service';
import { FeatureFlagService } from '../flags/feature-flag.service';
import { AchievementsAccess } from './achievements-access';

describe('AchievementsAccess', () => {
  function setup(achievementsHidden = false): AchievementsAccess {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: { currentUser: signal({ id: 'u1', achievementsHidden }) },
        },
        { provide: FeatureFlagService, useValue: { isOn: () => true } },
      ],
    });
    return TestBed.inject(AchievementsAccess);
  }

  it('starts from the opt-out on /me', () => {
    // Arrange
    const access = setup(true);

    // Assert
    expect(access.enabled()).toBe(false);
  });

  it('applies a disabled answer to a request sent after the last change', () => {
    // Arrange
    const access = setup();
    const since = access.since();

    // Act
    access.markDisabled(since);

    // Assert
    expect(access.enabled()).toBe(false);
  });

  it('ignores a disabled answer to a request sent before an opt-in', () => {
    // Arrange
    const access = setup(true);
    const since = access.since();

    // Act: the user opts back in while the request is in flight, then its 404 arrives
    access.markEnabled();
    access.markDisabled(since);

    // Assert
    expect(access.enabled()).toBe(true);
  });

  it('applies an opt-out without a since', () => {
    // Arrange
    const access = setup();

    // Act
    access.markDisabled();

    // Assert
    expect(access.enabled()).toBe(false);
  });
});
