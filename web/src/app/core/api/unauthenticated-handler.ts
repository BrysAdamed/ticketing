import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';

export const LOGIN_PATH = '/login';

/// Sends the user to the login page, remembering where they were. Separate from AuthService so
/// the HTTP interceptor does not depend on it (AuthService itself uses HttpClient).
@Injectable({ providedIn: 'root' })
export class UnauthenticatedHandler {
  private readonly router = inject(Router);
  private readonly listeners: (() => void)[] = [];

  onUnauthenticated(listener: () => void): void {
    this.listeners.push(listener);
  }

  handle(): void {
    this.listeners.forEach((listener) => listener());
    const current = this.router.url;
    if (current.startsWith(LOGIN_PATH)) return;
    void this.router.navigate([LOGIN_PATH], {
      queryParams: current && current !== '/' ? { returnUrl: current } : {},
    });
  }
}
