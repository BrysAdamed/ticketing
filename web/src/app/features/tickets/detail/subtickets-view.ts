import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { AuthService } from '@core/auth/auth.service';
import { FeatureFlagService } from '@core/flags/feature-flag.service';

export const SUBTICKETS_GRAPH_FLAG = 'ticket.subtickets-graph';

export type SubticketsView = 'list' | 'graph';

const STORAGE_PREFIX = 'tk-subtickets-view:';

/// List or graph in the ticket view's Sub-tickets section (D-95). The graph exists only while
/// flag `ticket.subtickets-graph` is on; the choice is remembered per user in this browser.
@Injectable({ providedIn: 'root' })
export class SubticketsViewPreference {
  private readonly auth = inject(AuthService);
  private readonly flags = inject(FeatureFlagService);
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly changed = signal(0);

  readonly graphAvailable = computed(() => this.flags.isOn(SUBTICKETS_GRAPH_FLAG));
  readonly view = computed<SubticketsView>(() => {
    this.changed();
    if (!this.graphAvailable()) return 'list';
    return this.read() === 'graph' ? 'graph' : 'list';
  });

  set(view: SubticketsView): void {
    try {
      this.storage?.setItem(this.storageKey(), view);
    } catch {
      return;
    } finally {
      this.changed.update((n) => n + 1);
    }
  }

  private read(): string | null {
    try {
      return this.storage?.getItem(this.storageKey()) ?? null;
    } catch {
      return null;
    }
  }

  private storageKey(): string {
    return STORAGE_PREFIX + (this.auth.currentUser()?.id ?? 'anonymous');
  }
}
