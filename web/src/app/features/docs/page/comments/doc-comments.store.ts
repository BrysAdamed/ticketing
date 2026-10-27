import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { DocComment, DocCommentsApi } from '@core/docs/doc-comments.api';
import { ToastService } from '@core/notify/toast.service';

export type DocCommentsStatus = 'idle' | 'loading' | 'loaded' | 'error';

/// A comment in the thread, `pending` while an optimistic add waits for the server.
export type DocThreadComment = DocComment & { pending?: boolean };

const PAGE_SIZE = 100;

/// The comment thread of one page or diagram (docs refinement D12): oldest first, paged by 100,
/// with optimistic add, edit and delete that roll back on failure. `onCountChange` hears every
/// change of the non-deleted count (rolled back changes included) so the doc's meta line follows.
@Injectable()
export class DocCommentsStore {
  private readonly api = inject(DocCommentsApi);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);
  private generation = 0;
  private pendingIds = 0;
  private docKey = '';
  private onCountChange: (delta: number) => void = () => undefined;

  readonly items = signal<readonly DocThreadComment[]>([]);
  readonly status = signal<DocCommentsStatus>('idle');
  readonly nextCursor = signal<string | null>(null);
  readonly loadingMore = signal(false);

  async load(docKey: string, onCountChange?: (delta: number) => void): Promise<void> {
    const generation = ++this.generation;
    this.docKey = docKey;
    this.onCountChange = onCountChange ?? (() => undefined);
    this.items.set([]);
    this.nextCursor.set(null);
    this.status.set('loading');
    try {
      const page = await firstValueFrom(this.api.list(docKey, { limit: PAGE_SIZE }));
      if (generation !== this.generation) return;
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.status.set('loaded');
    } catch {
      if (generation === this.generation) this.status.set('error');
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    const generation = this.generation;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(this.api.list(this.docKey, { limit: PAGE_SIZE, cursor }));
      if (generation !== this.generation) return;
      const known = new Set(this.items().map((c) => c.id));
      this.items.update((list) => [...list, ...page.items.filter((c) => !known.has(c.id))]);
      this.nextCursor.set(page.nextCursor);
    } catch (error) {
      this.toast.error(`Couldn't load more comments: ${toApiError(error).title}`);
    } finally {
      this.loadingMore.set(false);
    }
  }

  /// Adds a comment at the end at once (as pending) and replaces it with the server's copy.
  async add(body: string): Promise<boolean> {
    const text = body.trim();
    const me = this.auth.currentUser();
    if (!text || !me) return false;
    const generation = this.generation;
    const temp: DocThreadComment = {
      id: `pending-${++this.pendingIds}`,
      docKey: this.docKey,
      author: { id: me.id, email: me.email, displayName: me.displayName, isActive: true },
      body: text,
      createdAt: new Date().toISOString(),
      editedAt: null,
      deleted: false,
      deletedAt: null,
      canEdit: false,
      canDelete: false,
      pending: true,
    };
    this.items.update((list) => [...list, temp]);
    this.onCountChange(1);
    try {
      const saved = await firstValueFrom(this.api.add(this.docKey, text));
      if (generation === this.generation)
        this.items.update((list) => list.map((c) => (c.id === temp.id ? saved : c)));
      return true;
    } catch (error) {
      if (generation === this.generation) {
        this.items.update((list) => list.filter((c) => c.id !== temp.id));
        this.onCountChange(-1);
      }
      this.toast.error(`Couldn't add the comment: ${toApiError(error).title}`);
      return false;
    }
  }

  async edit(id: string, body: string): Promise<boolean> {
    const text = body.trim();
    const current = this.items().find((c) => c.id === id);
    if (!text || !current) return false;
    if (text === current.body) return true;
    this.replace(id, { ...current, body: text, editedAt: new Date().toISOString() });
    try {
      this.replace(id, await firstValueFrom(this.api.edit(id, text)));
      return true;
    } catch (error) {
      this.replace(id, current);
      this.toast.error(`Couldn't save the comment: ${toApiError(error).title}`);
      return false;
    }
  }

  async remove(id: string): Promise<void> {
    const current = this.items().find((c) => c.id === id);
    if (!current || current.deleted) return;
    this.replace(id, {
      ...current,
      body: '',
      deleted: true,
      deletedAt: new Date().toISOString(),
      canEdit: false,
      canDelete: false,
    });
    this.onCountChange(-1);
    try {
      this.replace(id, await firstValueFrom(this.api.delete(id)));
    } catch (error) {
      this.replace(id, current);
      this.onCountChange(1);
      this.toast.error(`Couldn't delete the comment: ${toApiError(error).title}`);
    }
  }

  private replace(id: string, comment: DocThreadComment): void {
    this.items.update((list) => list.map((c) => (c.id === id ? comment : c)));
  }
}
