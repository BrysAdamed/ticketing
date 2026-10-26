import { DOCUMENT } from '@angular/common';
import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';

export type ThemePreference = 'light' | 'dark' | 'system';
export type Theme = 'light' | 'dark';
export type Density = 'comfortable' | 'compact';

export const THEME_STORAGE_KEY = 'tk-theme';
export const DENSITY_STORAGE_KEY = 'tk-density';

/// Light/dark theme and row density. Persisted in localStorage and applied as `data-theme` /
/// `data-density` on <html> (public/theme-init.js applies the same before Angular boots).
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly media = this.document.defaultView?.matchMedia('(prefers-color-scheme: dark)');
  private readonly systemDark = signal(this.media?.matches ?? false);

  readonly preference = signal<ThemePreference>(readPreference(this.storage(THEME_STORAGE_KEY)));
  readonly density = signal<Density>(
    this.storage(DENSITY_STORAGE_KEY) === 'compact' ? 'compact' : 'comfortable',
  );
  readonly theme = computed<Theme>(() => {
    const preference = this.preference();
    if (preference === 'system') return this.systemDark() ? 'dark' : 'light';
    return preference;
  });

  constructor() {
    const onChange = (event: MediaQueryListEvent) => this.systemDark.set(event.matches);
    this.media?.addEventListener('change', onChange);
    inject(DestroyRef).onDestroy(() => this.media?.removeEventListener('change', onChange));

    effect(() => this.document.documentElement.setAttribute('data-theme', this.theme()));
    effect(() => {
      const root = this.document.documentElement;
      if (this.density() === 'compact') root.setAttribute('data-density', 'compact');
      else root.removeAttribute('data-density');
    });
  }

  setPreference(preference: ThemePreference): void {
    this.preference.set(preference);
    this.persist(THEME_STORAGE_KEY, preference);
  }

  toggle(): void {
    this.setPreference(this.theme() === 'dark' ? 'light' : 'dark');
  }

  setDensity(density: Density): void {
    this.density.set(density);
    this.persist(DENSITY_STORAGE_KEY, density);
  }

  private storage(key: string): string | null {
    try {
      return this.document.defaultView?.localStorage.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private persist(key: string, value: string): void {
    try {
      this.document.defaultView?.localStorage.setItem(key, value);
    } catch {
      return;
    }
  }
}

function readPreference(value: string | null): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}
