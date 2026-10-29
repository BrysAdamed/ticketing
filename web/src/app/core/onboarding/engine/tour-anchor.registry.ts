import { computed, Injectable, signal } from '@angular/core';

/// The tour anchors currently in the DOM, by anchor id. Filled by `tkTourAnchor`; read by the tour
/// engine, which never queries the DOM by selector. The latest registration of an id wins, so a
/// peek panel over a page can expose the same anchor as the page underneath.
@Injectable({ providedIn: 'root' })
export class TourAnchorRegistry {
  private readonly entries = signal<readonly { id: string; element: HTMLElement }[]>([]);
  private readonly waiters = new Map<string, Set<(element: HTMLElement) => void>>();

  readonly ids = computed(() => new Set(this.entries().map((e) => e.id)));

  register(id: string, element: HTMLElement): () => void {
    const entry = { id, element };
    this.entries.update((list) => [...list, entry]);
    const waiting = this.waiters.get(id);
    if (waiting) {
      this.waiters.delete(id);
      waiting.forEach((resolve) => resolve(element));
    }
    return () => this.entries.update((list) => list.filter((e) => e !== entry));
  }

  /// The element for an anchor id (reactive), or null when no view exposes it right now.
  get(id: string): HTMLElement | null {
    const matches = this.entries().filter((e) => e.id === id);
    return matches[matches.length - 1]?.element ?? null;
  }

  has(id: string): boolean {
    return this.ids().has(id);
  }

  /// Resolves with the anchor's element as soon as it is registered, or with null after
  /// `timeoutMs` (a lazy view still loading, or a step whose anchor this variant lacks).
  whenAvailable(id: string, timeoutMs: number): Promise<HTMLElement | null> {
    const current = this.get(id);
    if (current) return Promise.resolve(current);
    return new Promise((resolve) => {
      const waiting = this.waiters.get(id) ?? new Set();
      const done = (element: HTMLElement | null) => {
        clearTimeout(timer);
        waiting.delete(done);
        resolve(element);
      };
      const timer = setTimeout(() => done(null), timeoutMs);
      waiting.add(done);
      this.waiters.set(id, waiting);
    });
  }
}
