import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  PartialMatchRouteSnapshot,
  Route,
  Router,
  RouterStateSnapshot,
  UrlSegment,
  UrlTree,
} from '@angular/router';
import { adminGuard, authGuard, guestGuard, safeReturnUrl } from './auth.guards';
import { AuthService } from './auth.service';

class FakeAuth {
  readonly isAuthenticated = signal(false);
  readonly isAdmin = signal(false);
}

describe('auth guards', () => {
  let auth: FakeAuth;

  beforeEach(() => {
    auth = new FakeAuth();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        { provide: AuthService, useValue: auth },
      ],
    });
  });

  const runAuthGuard = (url: string) =>
    TestBed.runInInjectionContext(() =>
      authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot),
    );

  it('authGuard lets signed-in users through', () => {
    // Arrange
    auth.isAuthenticated.set(true);

    // Act
    const result = runAuthGuard('/projects/PAY/backlog');

    // Assert
    expect(result).toBe(true);
  });

  it('authGuard redirects anonymous users to /login with the return URL', () => {
    // Act
    const result = runAuthGuard('/projects/PAY/backlog?peek=PAY-1');

    // Assert
    expect(result).toBeInstanceOf(UrlTree);
    const serialized = TestBed.inject(Router).serializeUrl(result as UrlTree);
    expect(serialized).toBe('/login?returnUrl=%2Fprojects%2FPAY%2Fbacklog%3Fpeek%3DPAY-1');
  });

  it('authGuard omits returnUrl for the root URL', () => {
    // Act
    const result = runAuthGuard('/');

    // Assert
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/login');
  });

  it('adminGuard matches only for admins', () => {
    // Arrange
    const run = () =>
      TestBed.runInInjectionContext(() =>
        adminGuard({} as Route, [] as UrlSegment[], {} as PartialMatchRouteSnapshot),
      );

    // Act & Assert
    auth.isAuthenticated.set(true);
    expect(run()).toBe(false);
    auth.isAdmin.set(true);
    expect(run()).toBe(true);
  });

  it('guestGuard sends signed-in users to the default page', () => {
    // Arrange
    auth.isAuthenticated.set(true);

    // Act
    const result = TestBed.runInInjectionContext(() =>
      guestGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot),
    );

    // Assert
    expect(TestBed.inject(Router).serializeUrl(result as UrlTree)).toBe('/my-work');
  });

  it('safeReturnUrl rejects external and login URLs', () => {
    expect(safeReturnUrl('/projects/PAY')).toBe('/projects/PAY');
    expect(safeReturnUrl('https://evil.example')).toBe('/my-work');
    expect(safeReturnUrl('//evil.example')).toBe('/my-work');
    expect(safeReturnUrl('/login?returnUrl=/x')).toBe('/my-work');
    expect(safeReturnUrl(null)).toBe('/my-work');
  });
});
