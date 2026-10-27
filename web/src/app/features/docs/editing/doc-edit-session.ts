import { computed, DestroyRef, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { Doc, DocDraft, SaveDocDraft } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { DocStore } from '../doc/doc.store';
import type { MergeConflict } from './three-way-merge';

/// Autosave runs this long after the last change (spec 1.6).
export const AUTOSAVE_DELAY_MS = 1000;
const MAX_MERGE_ATTEMPTS = 3;

/// Where the draft stands, for the status line: `pending` (changed, autosave scheduled), `saving`,
/// `saved`, `error` (the last save failed; retry), `publishing`, `published`, `conflict`.
export type EditStatus =
  'clean' | 'pending' | 'saving' | 'saved' | 'error' | 'publishing' | 'published' | 'conflict';

export interface EditText {
  title: string;
  content: string;
}

/// Overlapping concurrent edits (spec 1.7): the latest published doc, my text, and where they clash.
export interface EditConflict {
  theirs: Doc;
  mine: EditText;
  regions: readonly MergeConflict[];
}

/// One user's edit of a page (or Mermaid source): the private draft with autosave, publishing
/// with `baseVersion`, and the 3-way merge when someone else published meanwhile (spec 1.6, 1.7).
/// Provided by the editor view; it reads and updates the open doc through `DocStore`.
@Injectable()
export class DocEditSession {
  private readonly api = inject(DocsApi);
  private readonly docs = inject(DocStore);
  private readonly toast = inject(ToastService);

  readonly key = signal('');
  readonly ready = signal(false);
  readonly title = signal('');
  readonly content = signal('');
  /// The published version this edit started from (sent as `baseVersion`).
  readonly baseVersion = signal(0);
  readonly status = signal<EditStatus>('clean');
  readonly savedAt = signal<string | null>(null);
  readonly publishedVersion = signal<number | null>(null);
  readonly conflict = signal<EditConflict | null>(null);
  /// My text kept beside the editor after "Keep editing on latest", to copy from.
  readonly reference = signal<EditText | null>(null);
  /// Bumped whenever `content` is replaced by the session, so the source editor reloads it.
  readonly revision = signal(0);
  /// A newer version than my base was published while I edit.
  readonly newerVersion = computed(() => {
    const doc = this.docs.doc();
    return doc && doc.key === this.key() && doc.version > this.baseVersion() ? doc : null;
  });

  private readonly bases = new Map<number, EditText>();
  private dirty = false;
  private hasDraft = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private saving: Promise<void> | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTimer());
  }

  /// Starts editing `doc`: from my draft when I have one, otherwise from the published text.
  async open(doc: Doc): Promise<void> {
    this.key.set(doc.key);
    this.bases.set(doc.version, { title: doc.title, content: doc.content ?? '' });
    let draft: DocDraft | null = null;
    if (doc.myDraft) {
      try {
        draft = await firstValueFrom(this.api.draft(doc.key));
      } catch (error) {
        if (!toApiError(error).isNotFound) this.toast.error(error);
      }
    }
    if (draft) {
      this.load({ title: draft.title || doc.title, content: draft.content }, draft.baseVersion);
      this.hasDraft = true;
      this.savedAt.set(draft.updatedAt);
      this.status.set('saved');
    } else {
      this.load({ title: doc.title, content: doc.content ?? '' }, doc.version);
      this.status.set('clean');
    }
    this.ready.set(true);
  }

  /// Applies a change typed by the user and schedules the autosave.
  edit(changes: Partial<EditText>): void {
    if (changes.title !== undefined) this.title.set(changes.title);
    if (changes.content !== undefined) this.content.set(changes.content);
    this.dirty = true;
    if (this.status() !== 'conflict') this.status.set('pending');
    this.clearTimer();
    this.timer = setTimeout(() => void this.save(), AUTOSAVE_DELAY_MS);
  }

  /// Saves the draft now if there are unsaved changes (on blur, before navigation, `Retry`).
  async flush(): Promise<void> {
    this.clearTimer();
    if (this.dirty) await this.save();
    else if (this.saving) await this.saving;
  }

  /// Saves unsaved changes with a request that survives the page being unloaded.
  saveOnUnload(): void {
    if (!this.dirty || !this.key()) return;
    this.clearTimer();
    this.api.saveDraftOnUnload(this.key(), this.snapshot());
  }

  hasUnsavedChanges(): boolean {
    return this.dirty;
  }

  /// Publishes the edit as a new version. A stale base is merged with the latest version: a clean
  /// merge is published with a toast, overlapping changes open the conflict view (`conflict`).
  /// Resolves with the published doc, or null when nothing was published.
  async publish(changeNote?: string | null): Promise<Doc | null> {
    const title = this.title().trim();
    if (!title) {
      this.toast.warning('Give the page a title before publishing.');
      return null;
    }
    this.clearTimer();
    if (this.saving) await this.saving;
    this.status.set('publishing');
    const mine = { title, content: this.content() };
    try {
      return await this.send(mine, this.baseVersion(), changeNote);
    } catch (error) {
      if (toApiError(error).code === 'doc.version.conflict')
        return this.merge(mine, changeNote, MAX_MERGE_ATTEMPTS);
      return this.failed(error);
    }
  }

  /// Conflict view: continue on the latest version, with my text in a side panel to copy from.
  keepEditingOnLatest(): void {
    const conflict = this.conflict();
    if (!conflict) return;
    this.conflict.set(null);
    this.reference.set(conflict.mine);
    this.load(
      { title: conflict.theirs.title, content: conflict.theirs.content ?? '' },
      conflict.theirs.version,
    );
    this.edit({});
  }

  /// Conflict view: publish my text over the latest version (theirs stays in history).
  async overwriteWithMine(changeNote?: string | null): Promise<Doc | null> {
    const conflict = this.conflict();
    if (!conflict) return null;
    this.status.set('publishing');
    try {
      const doc = await this.send(conflict.mine, conflict.theirs.version, changeNote);
      this.conflict.set(null);
      return doc;
    } catch (error) {
      this.status.set('conflict');
      this.toast.error(error);
      return null;
    }
  }

  /// Drops my draft (conflict view "Discard mine", or Discard in the editor). Resolves true when
  /// the draft is gone and the editor can close.
  async discard(): Promise<boolean> {
    this.clearTimer();
    if (this.saving) await this.saving;
    try {
      await firstValueFrom(this.api.discardDraft(this.key()));
    } catch (error) {
      this.toast.error(error);
      return false;
    }
    const latest = this.conflict()?.theirs ?? this.docs.doc();
    this.dirty = false;
    this.hasDraft = false;
    this.conflict.set(null);
    this.status.set('clean');
    if (latest && latest.key === this.key()) this.docs.set({ ...latest, myDraft: null });
    void this.docs.refresh();
    return true;
  }

  closeReference(): void {
    this.reference.set(null);
  }

  private load(text: EditText, baseVersion: number): void {
    this.title.set(text.title);
    this.content.set(text.content);
    this.baseVersion.set(baseVersion);
    this.revision.update((n) => n + 1);
  }

  private snapshot(): SaveDocDraft {
    return { baseVersion: this.baseVersion(), title: this.title(), content: this.content() };
  }

  private async save(): Promise<void> {
    this.clearTimer();
    if (this.saving) {
      await this.saving;
      if (!this.dirty) return;
    }
    const key = this.key();
    this.dirty = false;
    if (this.status() !== 'conflict') this.status.set('saving');
    this.saving = firstValueFrom(this.api.saveDraft(key, this.snapshot()))
      .then((draft) => {
        this.savedAt.set(draft.updatedAt);
        if (!this.dirty && this.status() === 'saving') this.status.set('saved');
        if (!this.hasDraft) {
          this.hasDraft = true;
          const doc = this.docs.doc();
          if (doc?.key === key && !doc.myDraft)
            this.docs.set({
              ...doc,
              myDraft: { baseVersion: draft.baseVersion, updatedAt: draft.updatedAt },
            });
        }
      })
      .catch(() => {
        this.dirty = true;
        if (this.status() !== 'conflict') this.status.set('error');
      })
      .finally(() => (this.saving = null));
    await this.saving;
  }

  private async send(
    mine: EditText,
    baseVersion: number,
    changeNote: string | null | undefined,
  ): Promise<Doc> {
    const base = await this.baseOf(baseVersion);
    const doc = await firstValueFrom(
      this.api.update(this.key(), {
        title: mine.title !== base.title ? mine.title : undefined,
        content: mine.content,
        baseVersion,
        changeNote: changeNote?.trim() || null,
      }),
    );
    this.published(doc, mine);
    return doc;
  }

  private published(doc: Doc, sent: EditText): void {
    this.bases.set(doc.version, { title: doc.title, content: doc.content ?? '' });
    this.baseVersion.set(doc.version);
    this.hasDraft = false;
    this.docs.set(doc);
    this.publishedVersion.set(doc.version);
    const typedSince = this.title().trim() !== sent.title || this.content() !== sent.content;
    this.dirty = typedSince;
    this.status.set(typedSince ? 'pending' : 'published');
    if (typedSince) this.edit({});
  }

  private async merge(
    mine: EditText,
    changeNote: string | null | undefined,
    attempts: number,
  ): Promise<Doc | null> {
    try {
      const [theirs, base, { mergeThreeWay }] = await Promise.all([
        firstValueFrom(this.api.get(this.key())),
        this.baseOf(this.baseVersion()),
        import('./three-way-merge'),
      ]);
      this.docs.set(theirs);
      this.bases.set(theirs.version, { title: theirs.title, content: theirs.content ?? '' });
      const result = mergeThreeWay(base.content, mine.content, theirs.content ?? '');
      const title = mine.title !== base.title ? mine.title : theirs.title;
      if (!result.clean) {
        this.conflict.set({ theirs, mine, regions: result.conflicts });
        this.status.set('conflict');
        return null;
      }
      const merged = { title, content: result.text };
      this.title.set(merged.title);
      this.content.set(merged.content);
      this.revision.update((n) => n + 1);
      try {
        const doc = await this.send(merged, theirs.version, changeNote);
        this.toast.success(
          `Merged with ${theirs.updatedBy.displayName}'s changes (v${theirs.version})`,
        );
        return doc;
      } catch (error) {
        if (toApiError(error).code === 'doc.version.conflict' && attempts > 1) {
          this.baseVersion.set(theirs.version);
          return this.merge(merged, changeNote, attempts - 1);
        }
        throw error;
      }
    } catch (error) {
      return this.failed(error);
    }
  }

  private failed(error: unknown): null {
    if (this.dirty) this.edit({});
    else this.status.set(this.hasDraft ? 'saved' : 'clean');
    this.toast.error(error);
    return null;
  }

  /// The title and content of a published version, fetched once.
  private async baseOf(version: number): Promise<EditText> {
    const known = this.bases.get(version);
    if (known) return known;
    const fetched = await firstValueFrom(this.api.version(this.key(), version));
    const text = { title: fetched.title, content: fetched.content ?? '' };
    this.bases.set(version, text);
    return text;
  }

  private clearTimer(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
