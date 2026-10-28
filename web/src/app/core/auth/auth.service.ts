import { HttpContext } from '@angular/common/http';
import { computed, inject, Injectable, signal } from '@angular/core';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError } from '../api/api-error';
import { SKIP_AUTH_REDIRECT } from '../api/api-error.interceptor';
import { SwrCache } from '../api/swr-cache';
import { LOGIN_PATH, UnauthenticatedHandler } from '../api/unauthenticated-handler';
import { FeatureFlagService } from '../flags/feature-flag.service';
import { AvatarDirectory } from '../users/avatar-directory';
import { CurrentUser, LoginRequest } from './current-user';

const quiet = () => ({ context: new HttpContext().set(SKIP_AUTH_REDIRECT, true) });

/// Owns the cookie session: bootstraps it at startup (CSRF cookie, then /me), signs in and out,
/// and exposes the signed-in user as signals.
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly api = inject(ApiClient);
  private readonly router = inject(Router);
  private readonly flags = inject(FeatureFlagService);
  private readonly cache = inject(SwrCache);
  private readonly avatars = inject(AvatarDirectory);

  private readonly user = signal<CurrentUser | null>(null);

  readonly currentUser = this.user.asReadonly();
  readonly isAuthenticated = computed(() => this.user() !== null);
  readonly isAdmin = computed(() => this.user()?.globalRole === 'Admin');

  constructor() {
    inject(UnauthenticatedHandler).onUnauthenticated(() => this.clearSession());
  }

  async initialize(): Promise<void> {
    try {
      await firstValueFrom(this.api.get<void>('/auth/csrf', undefined, quiet()));
      const user = await firstValueFrom(this.api.get<CurrentUser>('/me', undefined, quiet()));
      this.user.set(user);
      void this.avatars.load();
      await this.flags.load();
    } catch {
      this.user.set(null);
    }
  }

  async login(request: LoginRequest): Promise<CurrentUser> {
    const user = await firstValueFrom(this.api.post<CurrentUser>('/auth/login', request, quiet()));
    this.cache.clear();
    this.user.set(user);
    void this.avatars.load();
    await this.flags.load();
    return user;
  }

  async logout(): Promise<void> {
    try {
      await firstValueFrom(this.api.post<void>('/auth/logout', null, quiet()));
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
    } finally {
      this.clearSession();
      await this.router.navigateByUrl(LOGIN_PATH);
    }
  }

  async refreshUser(): Promise<void> {
    this.user.set(await firstValueFrom(this.api.get<CurrentUser>('/me')));
  }

  private clearSession(): void {
    this.user.set(null);
    this.flags.clear();
    this.cache.clear();
    this.avatars.clear();
  }
}
