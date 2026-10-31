import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { projectKeyOfDoc } from '@core/docs/doc-links';
import { Doc } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import { Watchers } from '@core/tickets/ticket.models';
import { NO_WATCHERS, withoutWatcher, withWatcher } from '@core/watchers/watchers';
import { docsTreeTag } from '../tree/doc-tree.store';

/// The open doc (`GET /docs/{key}`), cached per key so a revisit paints at once. Provided by the
/// doc view, so the content views (page, diagram, folder) and later the editor share it; call
/// `set` after a write that returns the doc.
@Injectable()
export class DocStore {
  private readonly api = inject(DocsApi);
  private readonly cache = inject(SwrCache);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private generation = 0;
  private watchToken = 0;
  private watchesInFlight = 0;

  readonly key = signal('');
  readonly doc = signal<Doc | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  async load(key: string): Promise<void> {
    const generation = ++this.generation;
    this.key.set(key);
    this.error.set(null);
    const { cached, fresh } = this.cache.load(
      cacheKey(key),
      () => firstValueFrom(this.api.get(key)),
      [`doc:${key}`, docsTreeTag(projectKeyOfDoc(key))],
    );
    if (cached) {
      this.doc.set(cached);
      this.status.set('loaded');
    } else {
      this.doc.set(null);
      this.status.set('loading');
    }
    try {
      const doc = await fresh;
      if (generation !== this.generation) return;
      this.doc.set(doc);
      this.status.set('loaded');
    } catch (error) {
      if (generation !== this.generation) return;
      const apiError = toApiError(error);
      if (cached && !apiError.isNotFound) return;
      this.cache.invalidate(`doc:${key}`);
      this.doc.set(null);
      this.error.set(apiError);
      this.status.set('error');
    }
  }

  reload(): Promise<void> {
    return this.load(this.key());
  }

  /// Refetches the open doc in the background (after a move or rename changed its path).
  async refresh(): Promise<void> {
    const key = this.key();
    if (!key || !this.doc()) return;
    try {
      const doc = await firstValueFrom(this.api.get(key));
      if (this.key() !== key) return;
      this.set(
        this.watchesInFlight ? { ...doc, watchers: this.doc()?.watchers ?? doc.watchers } : doc,
      );
    } catch {
      return;
    }
  }

  set(doc: Doc): void {
    this.doc.set(doc);
    this.cache.set(cacheKey(doc.key), doc, [`doc:${doc.key}`, docsTreeTag(doc.projectKey)]);
  }

  /// `W`: watches or unwatches the open page or diagram at once and rolls back with an error toast
  /// if the server refuses (D-161). Only the latest of several quick toggles applies its response.
  async toggleWatch(): Promise<void> {
    const doc = this.doc();
    const me = this.auth.currentUser();
    if (!doc || !me || doc.kind === 'Folder') return;
    const before = doc.watchers ?? NO_WATCHERS;
    const watch = !before.watching;
    const token = ++this.watchToken;
    this.setWatchers(
      doc.key,
      watch
        ? withWatcher(before, {
            id: me.id,
            email: me.email,
            displayName: me.displayName,
            isActive: true,
          })
        : withoutWatcher(before, me.id),
    );
    this.watchesInFlight++;
    try {
      const fresh = await firstValueFrom(
        watch ? this.api.watch(doc.key) : this.api.unwatch(doc.key),
      );
      if (token === this.watchToken) this.setWatchers(doc.key, fresh);
    } catch (error) {
      if (token === this.watchToken) this.setWatchers(doc.key, before);
      this.toast.error(
        `Couldn't ${watch ? 'watch' : 'unwatch'} ${doc.key}: ${toApiError(error).title}`,
      );
    } finally {
      this.watchesInFlight--;
    }
  }

  private setWatchers(key: string, watchers: Watchers): void {
    const current = this.doc();
    if (current?.key === key) this.set({ ...current, watchers });
  }
}

function cacheKey(key: string): string {
  return `doc:${key}`;
}
