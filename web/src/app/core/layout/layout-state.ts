import { DOCUMENT } from '@angular/common';
import { inject, Injectable, signal } from '@angular/core';

const SIDEBAR_KEY = 'tk-sidebar-collapsed';

/// Shell UI state persisted per browser: sidebar collapsed to the 48px rail.
@Injectable({ providedIn: 'root' })
export class LayoutState {
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  readonly sidebarCollapsed = signal(this.read() === 'true');

  toggleSidebar(): void {
    this.sidebarCollapsed.update((v) => !v);
    try {
      this.storage?.setItem(SIDEBAR_KEY, String(this.sidebarCollapsed()));
    } catch {
      return;
    }
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(SIDEBAR_KEY) ?? null;
    } catch {
      return null;
    }
  }
}
