import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AchievementSharesApi } from '../../achievements/achievement-shares.api';
import { AuthService } from '../../auth/auth.service';
import { FeatureFlagService } from '../../flags/feature-flag.service';
import { USER_CARD_HOVER_MS, UserCardDirective } from './user-card.directive';

const ANNA = { id: 'anna', displayName: 'Anna Kowalska' };

@Component({
  imports: [UserCardDirective],
  template: `
    <b data-testid="name" [tkUserCard]="user">Anna</b>
    <span data-testid="avatar" [tkUserCard]="user" tkUserCardTrigger="hover">AK</span>
  `,
})
class HostComponent {
  user = ANNA;
}

describe('UserCardDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AchievementSharesApi, useValue: { sharedBy: () => of({ items: [] }) } },
        { provide: FeatureFlagService, useValue: { isOn: () => false } },
        { provide: AuthService, useValue: { currentUser: signal({ id: 'me' }) } },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    await fixture.whenStable();
  });

  afterEach(() => vi.useRealTimers());

  const el = (id: string) =>
    (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  const card = () => document.querySelector<HTMLElement>('[data-testid="user-card"]');

  it('makes a name a button that opens the card on Enter, and Esc returns focus', async () => {
    // Arrange
    const name = el('name');
    name.focus();

    // Act
    name.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();

    // Assert
    expect(name.getAttribute('role')).toBe('button');
    expect(name.getAttribute('tabindex')).toBe('0');
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(card()?.textContent).toContain('Anna Kowalska');
    expect(card()?.getAttribute('role')).toBe('dialog');

    // Act
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await fixture.whenStable();

    // Assert
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(name);
  });

  it('opens a hover card only after the pointer rests for the hover delay', async () => {
    // Arrange
    vi.useFakeTimers();
    const avatar = el('avatar');

    // Act
    avatar.dispatchEvent(new MouseEvent('mouseenter'));
    vi.advanceTimersByTime(USER_CARD_HOVER_MS - 1);
    const early = card();
    vi.advanceTimersByTime(1);
    await fixture.whenStable();

    // Assert
    expect(early).toBeNull();
    expect(card()).not.toBeNull();
    expect(avatar.getAttribute('role')).toBeNull();

    // Act
    avatar.dispatchEvent(new MouseEvent('mouseleave'));
    vi.advanceTimersByTime(200);

    // Assert
    expect(card()).toBeNull();
  });
});
