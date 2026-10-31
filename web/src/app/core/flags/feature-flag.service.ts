import { DOCUMENT } from '@angular/common';
import { HttpContext } from '@angular/common/http';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { SKIP_AUTH_REDIRECT } from '../api/api-error.interceptor';
import { FlagKey } from './flag-keys';

export const FLAG_OFF = 'off';
export const FLAG_ON = 'on';
export const FLAG_REFRESH_AFTER_MS = 5 * 60 * 1000;

export type FlagVariants = Readonly<Record<string, string>>;

interface FlagsResponse {
  flags: Record<string, string>;
}

/// Feature flags evaluated by the server for the signed-in user (spec 6.13). Loaded at sign-in
/// and refreshed on window focus when older than five minutes. Keys are declared in
/// `flag-keys.ts` (D-169); a key the server did not send is `off`.
@Injectable({ providedIn: 'root' })
export class FeatureFlagService {
  private readonly api = inject(ApiClient);
  private readonly state = signal<FlagVariants>({});
  private loadedAt = 0;
  private loaded = false;

  readonly flags = this.state.asReadonly();

  constructor() {
    const window = inject(DOCUMENT).defaultView;
    if (!window) return;
    const onFocus = () => void this.refreshIfStale();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  variant(key: FlagKey): string {
    return this.state()[key] ?? FLAG_OFF;
  }

  isOn(key: FlagKey): boolean {
    return this.variant(key) === FLAG_ON;
  }

  async load(): Promise<void> {
    try {
      const response = await firstValueFrom(
        this.api.get<FlagsResponse>('/me/flags', undefined, {
          context: new HttpContext().set(SKIP_AUTH_REDIRECT, true),
        }),
      );
      this.state.set({ ...response.flags });
      this.loaded = true;
    } catch {
      this.state.set({});
    } finally {
      this.loadedAt = Date.now();
    }
  }

  async refreshIfStale(now = Date.now()): Promise<void> {
    if (!this.loaded || now - this.loadedAt < FLAG_REFRESH_AFTER_MS) return;
    await this.load();
  }

  clear(): void {
    this.state.set({});
    this.loaded = false;
    this.loadedAt = 0;
  }
}
