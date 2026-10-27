import { computed, Injectable, signal } from '@angular/core';

const MAX_ENTRIES = 50;

interface Entry {
  value: unknown;
  tags: readonly string[];
}

/// Result of `SwrCache.load`: the cached value to render at once (if any) and the fresh one.
export interface SwrLoad<T> {
  cached: T | undefined;
  fresh: Promise<T>;
}

/// Stale-while-revalidate cache for read models (project, backlog, my work, dashboard): a revisited
/// view renders the last value at once and swaps in the fresh one when it arrives. Entries carry tags
/// (for example `project:PAY`) so writes can drop what they made wrong. `revalidating` drives the
/// top progress line while cached data is on screen and a refetch runs.
@Injectable({ providedIn: 'root' })
export class SwrCache {
  private readonly entries = new Map<string, Entry>();
  private readonly pending = signal(0);

  readonly revalidating = computed(() => this.pending() > 0);

  get<T>(key: string): T | undefined {
    return this.entries.get(key)?.value as T | undefined;
  }

  set<T>(key: string, value: T, tags: readonly string[] = []): void {
    this.entries.delete(key);
    this.entries.set(key, { value, tags });
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
  }

  /// Removes every entry tagged with `tag`.
  invalidate(tag: string): void {
    for (const [key, entry] of this.entries) {
      if (entry.tags.includes(tag)) this.entries.delete(key);
    }
  }

  clear(): void {
    this.entries.clear();
  }

  /// Returns the cached value (if any) and starts `fetch`; the fresh value replaces the entry. While a
  /// cached value is shown, the fetch counts as a background revalidation.
  load<T>(key: string, fetch: () => Promise<T>, tags: readonly string[] = []): SwrLoad<T> {
    const cached = this.get<T>(key);
    const request = fetch().then((value) => {
      this.set(key, value, tags);
      return value;
    });
    return { cached, fresh: cached === undefined ? request : this.track(request) };
  }

  /// Counts `work` as a background revalidation until it settles.
  track<T>(work: Promise<T>): Promise<T> {
    this.pending.update((n) => n + 1);
    return work.finally(() => this.pending.update((n) => n - 1));
  }
}
