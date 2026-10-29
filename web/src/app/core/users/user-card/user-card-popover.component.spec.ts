import { provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, DeferBlockState, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../api/api-error';
import { SharedAchievements } from '../../achievements/achievement.models';
import { AchievementSharesApi } from '../../achievements/achievement-shares.api';
import { AuthService } from '../../auth/auth.service';
import { FeatureFlagService } from '../../flags/feature-flag.service';
import { UserCardPopoverComponent } from './user-card-popover.component';

const ANNA = { id: 'anna', displayName: 'Anna Kowalska', email: 'anna@example.com' };

describe('UserCardPopoverComponent', () => {
  let flags: Record<string, string>;
  let response: () => ReturnType<AchievementSharesApi['sharedBy']>;
  let sharedBy: ReturnType<typeof vi.fn>;

  async function render(user = ANNA): Promise<ComponentFixture<UserCardPopoverComponent>> {
    sharedBy = vi.fn(() => response());
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AchievementSharesApi, useValue: { sharedBy } },
        { provide: FeatureFlagService, useValue: { isOn: (key: string) => flags[key] === 'on' } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
      ],
    });
    const fixture = TestBed.createComponent(UserCardPopoverComponent);
    fixture.componentRef.setInput('user', user);
    await fixture.whenStable();
    for (const block of await fixture.getDeferBlocks())
      await block.render(DeferBlockState.Complete);
    return fixture;
  }

  const text = (fixture: ComponentFixture<UserCardPopoverComponent>) =>
    (fixture.nativeElement as HTMLElement).textContent ?? '';

  beforeEach(() => {
    flags = { achievements: 'on' };
    response = () =>
      of<SharedAchievements>({
        items: [{ id: 'reporter', name: 'Reporter', icon: 'file-plus', tier: 2 }],
      });
  });

  it('shows the name but never the email, and fetches the shared achievements', async () => {
    // Act
    const fixture = await render();

    // Assert
    expect(text(fixture)).toContain('Anna Kowalska');
    expect(text(fixture)).not.toContain('anna@example.com');
    expect(sharedBy).toHaveBeenCalledWith('anna');
    expect(text(fixture)).toContain('Shared achievements');
  });

  it('asks nothing and shows no section while achievements are off for the viewer', async () => {
    // Arrange
    flags = {};

    // Act
    const fixture = await render();

    // Assert
    expect(sharedBy).not.toHaveBeenCalled();
    expect(text(fixture)).toContain('Anna Kowalska');
    expect(text(fixture)).not.toContain('Shared achievements');
  });

  it('shows no section when the owner is hidden behind a 404', async () => {
    // Arrange
    response = () => throwError(() => new ApiError(404, 'user.notFound', 'User not found.'));

    // Act
    const fixture = await render();

    // Assert
    expect(text(fixture)).toContain('Anna Kowalska');
    expect(text(fixture)).not.toContain('Shared achievements');
  });

  it('says "You" and "Shared by you" on your own card, with the manage link', async () => {
    // Act
    const fixture = await render({ id: 'me', displayName: 'Kasia Dąbrowska', email: 'k@x' });

    // Assert
    expect(text(fixture)).toContain('You');
    expect(text(fixture)).toContain('Shared by you');
    const link = (fixture.nativeElement as HTMLElement).querySelector(
      '[data-testid="user-card-manage"]',
    );
    expect(link?.getAttribute('href')).toBe('/profile/achievements');
  });
});
