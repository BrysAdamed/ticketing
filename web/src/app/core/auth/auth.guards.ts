import { inject } from '@angular/core';
import { CanActivateFn, CanMatchFn, Router } from '@angular/router';
import { LOGIN_PATH } from '../api/unauthenticated-handler';
import { AuthService } from './auth.service';

export const DEFAULT_ROUTE = '/my-work';

/// Requires a signed-in user; otherwise redirects to /login?returnUrl=<target>.
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  if (auth.isAuthenticated()) return true;
  const router = inject(Router);
  return router.createUrlTree([LOGIN_PATH], {
    queryParams: state.url && state.url !== '/' ? { returnUrl: state.url } : {},
  });
};

/// Matches only for Admins. Non-admins fall through to the next route (the 404 page), so admin
/// URLs do not reveal that they exist.
export const adminGuard: CanMatchFn = () => inject(AuthService).isAdmin();

/// Keeps signed-in users away from the login page.
export const guestGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  return auth.isAuthenticated() ? inject(Router).parseUrl(DEFAULT_ROUTE) : true;
};

export function safeReturnUrl(url: string | null | undefined): string {
  if (!url || !url.startsWith('/') || url.startsWith('//') || url.startsWith(LOGIN_PATH)) {
    return DEFAULT_ROUTE;
  }
  return url;
}
