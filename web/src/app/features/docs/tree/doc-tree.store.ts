import { DOCUMENT } from '@angular/common';
import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import {
  DiagramFormat,
  Doc,
  DOC_TREE_LIMITS,
  DocKind,
  DocPlacement,
  DocTree,
  DocTreeItem,
} from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus } from '@core/projects/project-directory';
import {
  ancestorsOf,
  applyInsert,
  applyMove,
  applyPatch,
  applyRemove,
  childrenOf,
  CreateDraft,
  descendantsOf,
  indexTree,
  isSelfOrDescendant,
  MOVE_REFUSAL_MESSAGES,
  NodeRow,
  ParentKey,
  reorderPlacement,
  titleTaken,
  validateMove,
  visibleRows,
} from './doc-tree-logic';

const EXPANDED_KEY = 'tk-docs-expanded:';
const PENDING_PREFIX = 'pending-';

export const KIND_LABELS: Record<DocKind, string> = {
  Folder: 'folder',
  Page: 'page',
  Diagram: 'diagram',
};

export function docsTreeTag(projectKey: string): string {
  return `docs:${projectKey}`;
}

export function isPendingKey(key: string): boolean {
  return key.startsWith(PENDING_PREFIX);
}

/// The project's docs tree for the whole Docs section (provided by the docs layout): the flat
/// tree, expanded folders (kept per project in localStorage), the `/` filter, the keyboard cursor
/// and the inline create/rename state. Every change is optimistic and rolled back with a toast
/// when the server refuses it; moves are checked locally first with the server's rules.
@Injectable()
export class DocTreeStore {
  private readonly api = inject(DocsApi);
  private readonly cache = inject(SwrCache);
  private readonly toast = inject(ToastService);
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private loadGeneration = 0;
  private pendingCounter = 0;

  readonly projectKey = signal('');
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<string | null>(null);
  readonly items = signal<readonly DocTreeItem[]>([]);
  readonly canWrite = signal(false);
  readonly canManageTrash = signal(false);
  readonly expanded = signal<ReadonlySet<string>>(new Set());
  readonly filter = signal('');
  readonly cursorKey = signal<string | null>(null);
  readonly activeKey = signal<string | null>(null);
  readonly creating = signal<CreateDraft | null>(null);
  readonly renamingKey = signal<string | null>(null);
  /// Bumped after a rename, move or restore succeeded: open docs refetch their path.
  readonly structureVersion = signal(0);
  /// Asks the tree panel to open a doc's action menu at a point (the page bar's "…" button).
  readonly menuRequest = signal<{ key: string; x: number; y: number } | null>(null);

  readonly index = computed(() => indexTree(this.items()));
  readonly rows = computed(() =>
    visibleRows(this.items(), this.expanded(), this.filter(), this.creating()),
  );
  readonly documentCount = computed(() => this.items().filter((i) => i.kind !== 'Folder').length);
  readonly isEmpty = computed(() => this.status() === 'loaded' && this.items().length === 0);
  readonly folders = computed(() => this.items().filter((i) => i.kind === 'Folder'));
  readonly cursor = computed(() => {
    const key = this.cursorKey();
    return key ? (this.index().byKey.get(key) ?? null) : null;
  });

  item(key: string): DocTreeItem | null {
    return this.index().byKey.get(key) ?? null;
  }

  children(parentKey: ParentKey): readonly DocTreeItem[] {
    return childrenOf(this.index(), parentKey);
  }

  /// Folder titles from the root down to `key`'s parent.
  pathOf(key: string): string[] {
    const index = this.index();
    return ancestorsOf(index, key)
      .reverse()
      .map((k) => index.byKey.get(k)?.title ?? '');
  }

  contains(ancestorKey: string, key: string): boolean {
    return isSelfOrDescendant(this.index(), key, ancestorKey);
  }

  /// Shows the cached tree at once (stale-while-revalidate) and swaps in the fresh one.
  async load(projectKey: string): Promise<void> {
    const generation = ++this.loadGeneration;
    if (projectKey !== this.projectKey()) {
      this.projectKey.set(projectKey);
      this.expanded.set(this.readExpanded(projectKey));
      this.filter.set('');
      this.creating.set(null);
      this.renamingKey.set(null);
      this.items.set([]);
      this.status.set('idle');
    }
    const { cached, fresh } = this.cache.load(
      this.cacheKey(projectKey),
      () => firstValueFrom(this.api.tree(projectKey)),
      [`project:${projectKey}`, docsTreeTag(projectKey)],
    );
    if (cached) this.apply(cached);
    else if (this.status() !== 'loaded') this.status.set('loading');
    try {
      const tree = await fresh;
      if (generation === this.loadGeneration) this.apply(tree);
    } catch (error) {
      if (generation !== this.loadGeneration) return;
      if (cached) return;
      this.error.set(toApiError(error).title);
      this.status.set('error');
    }
  }

  reload(): Promise<void> {
    return this.load(this.projectKey());
  }

  // Expand, collapse, filter

  toggle(key: string, open?: boolean): void {
    const item = this.item(key);
    if (!item || item.kind !== 'Folder') return;
    const next = new Set(this.expanded());
    if (open ?? !next.has(key)) next.add(key);
    else next.delete(key);
    this.setExpanded(next);
  }

  /// Expands the folders above `key` so it is visible, and puts the cursor on it.
  reveal(key: string): void {
    const ancestors = ancestorsOf(this.index(), key);
    if (ancestors.some((a) => !this.expanded().has(a)))
      this.setExpanded(new Set([...this.expanded(), ...ancestors]));
    this.cursorKey.set(key);
  }

  setFilter(value: string): void {
    this.filter.set(value);
  }

  // Keyboard cursor

  step(delta: 1 | -1): void {
    const nodes = this.nodeRows();
    if (nodes.length === 0) return;
    const at = nodes.findIndex((r) => r.item.key === this.cursorKey());
    const next = at < 0 ? (delta > 0 ? 0 : nodes.length - 1) : at + delta;
    const row = nodes[Math.max(0, Math.min(nodes.length - 1, next))];
    this.cursorKey.set(row.item.key);
  }

  /// → on a collapsed folder expands it, on an open one moves to its first child.
  expandOrEnter(): void {
    const row = this.cursorRow();
    if (!row || row.item.kind !== 'Folder') return;
    if (!row.expanded) this.toggle(row.item.key, true);
    else if (row.hasChildren) this.step(1);
  }

  /// ← on an open folder collapses it, elsewhere moves to the parent folder.
  collapseOrLeave(): void {
    const row = this.cursorRow();
    if (!row) return;
    if (row.item.kind === 'Folder' && row.expanded && !this.filter())
      this.toggle(row.item.key, false);
    else if (row.item.parentKey) this.cursorKey.set(row.item.parentKey);
  }

  /// The folder new docs go into: the cursor's folder, or the folder holding the cursor.
  currentFolder(): ParentKey {
    const cursor = this.cursor();
    if (!cursor) return null;
    return cursor.kind === 'Folder' ? cursor.key : cursor.parentKey;
  }

  // Create

  startCreate(kind: DocKind, parentKey: ParentKey = this.currentFolder()): void {
    if (!this.canWrite()) return;
    this.renamingKey.set(null);
    if (parentKey) this.reveal(parentKey);
    if (parentKey) this.toggle(parentKey, true);
    this.creating.set({
      parentKey,
      kind,
      diagramFormat: kind === 'Diagram' ? 'Mermaid' : null,
    });
  }

  setCreateFormat(format: DiagramFormat): void {
    const draft = this.creating();
    if (draft?.kind === 'Diagram') this.creating.set({ ...draft, diagramFormat: format });
  }

  cancelCreate(): void {
    this.creating.set(null);
  }

  /// Validation message for a title typed in the inline create or rename input, or null.
  titleProblem(
    title: string,
    parentKey: ParentKey,
    exceptKey: string | null = null,
  ): string | null {
    const trimmed = title.trim();
    if (!trimmed) return 'Enter a title.';
    if (trimmed.length > DOC_TREE_LIMITS.titleMaxLength)
      return `Titles are at most ${DOC_TREE_LIMITS.titleMaxLength} characters.`;
    if (titleTaken(this.index(), parentKey, trimmed, exceptKey))
      return `"${trimmed}" already exists in this folder.`;
    return null;
  }

  /// Creates the drafted doc at the bottom of its folder: a pending row at once, replaced by the
  /// server's node. Resolves with the new doc, or null when it failed (the row is removed).
  async submitCreate(title: string): Promise<Doc | null> {
    const draft = this.creating();
    if (!draft || this.titleProblem(title, draft.parentKey)) return null;
    this.creating.set(null);
    const pendingKey = `${PENDING_PREFIX}${++this.pendingCounter}`;
    const placement: DocPlacement = { parent: draft.parentKey ?? 'root' };
    this.items.update((items) =>
      applyInsert(items, pendingItem(pendingKey, draft, title.trim()), placement),
    );
    this.cursorKey.set(pendingKey);
    try {
      const doc = await firstValueFrom(
        this.api.create(
          this.projectKey(),
          {
            kind: draft.kind,
            title: title.trim(),
            parent: placement.parent,
            ...(draft.diagramFormat ? { diagramFormat: draft.diagramFormat } : {}),
          },
          crypto.randomUUID(),
        ),
      );
      this.items.update((items) =>
        items.map((i) => (i.key === pendingKey ? treeItemOf(doc, i.depth) : i)),
      );
      if (this.cursorKey() === pendingKey) this.cursorKey.set(doc.key);
      this.persist();
      return doc;
    } catch (error) {
      this.items.update((items) => applyRemove(items, pendingKey).items);
      this.toast.error(
        `Couldn't create the ${KIND_LABELS[draft.kind]}: ${toApiError(error).title}`,
      );
      return null;
    }
  }

  // Rename

  startRename(key: string | null = this.cursorKey()): void {
    const item = key ? this.item(key) : null;
    if (!item || !this.canWrite() || isPendingKey(item.key)) return;
    this.creating.set(null);
    this.reveal(item.key);
    this.renamingKey.set(item.key);
  }

  cancelRename(): void {
    this.renamingKey.set(null);
  }

  /// Renames optimistically; resolves with the server's title, or null when nothing was saved.
  async submitRename(key: string, title: string): Promise<string | null> {
    this.renamingKey.set(null);
    const item = this.item(key);
    const trimmed = title.trim();
    if (!item || trimmed === item.title) return null;
    const problem = this.titleProblem(trimmed, item.parentKey, key);
    if (problem) {
      this.toast.warning(problem);
      return null;
    }
    const previous = item.title;
    this.items.update((items) => applyPatch(items, key, { title: trimmed }));
    try {
      const doc = await firstValueFrom(this.api.rename(key, trimmed));
      this.items.update((items) =>
        applyPatch(items, key, { title: doc.title, updatedAt: doc.updatedAt }),
      );
      this.structureChanged();
      return doc.title;
    } catch (error) {
      this.items.update((items) => applyPatch(items, key, { title: previous }));
      this.toast.error(`Couldn't rename "${previous}": ${toApiError(error).title}`);
      return null;
    }
  }

  // Move

  /// Why `key` cannot move to `placement` (a message for the user), or null when it can; null
  /// also for a move that changes nothing.
  moveProblem(key: string, placement: DocPlacement): string | null {
    const refusal = validateMove(this.index(), key, placement);
    return refusal && refusal !== 'noop' ? MOVE_REFUSAL_MESSAGES[refusal] : null;
  }

  /// Moves at once and rolls back with a toast when the server refuses. Returns false when the
  /// move was refused locally (with a toast) or changes nothing.
  async move(key: string, placement: DocPlacement): Promise<boolean> {
    if (!this.canWrite() || isPendingKey(key)) return false;
    const refusal = validateMove(this.index(), key, placement);
    if (refusal === 'noop') return false;
    if (refusal) {
      this.toast.warning(MOVE_REFUSAL_MESSAGES[refusal]);
      return false;
    }
    const before = this.items();
    this.items.set(applyMove(before, key, placement));
    this.reveal(key);
    try {
      await firstValueFrom(this.api.move(key, placement));
      this.structureChanged();
      return true;
    } catch (error) {
      this.items.set(rollback(this.items(), before, key));
      this.toast.error(
        `Couldn't move "${this.item(key)?.title ?? key}": ${toApiError(error).title}`,
      );
      return false;
    }
  }

  /// Alt+↑ / Alt+↓: one step among the siblings.
  reorder(delta: -1 | 1): void {
    const key = this.cursorKey();
    const placement = key ? reorderPlacement(this.index(), key, delta) : null;
    if (key && placement) void this.move(key, placement);
  }

  // Duplicate

  async duplicate(key: string): Promise<Doc | null> {
    const item = this.item(key);
    if (!item || item.kind === 'Folder' || !this.canWrite() || isPendingKey(key)) return null;
    try {
      const doc = await firstValueFrom(this.api.duplicate(key));
      this.items.update((items) =>
        applyInsert(items, treeItemOf(doc, item.depth), {
          parent: item.parentKey ?? 'root',
          afterKey: item.key,
        }),
      );
      this.cursorKey.set(doc.key);
      this.persist();
      this.toast.success(`Duplicated as "${doc.title}"`);
      return doc;
    } catch (error) {
      this.toast.error(`Couldn't duplicate "${item.title}": ${toApiError(error).title}`);
      return null;
    }
  }

  // Delete and restore

  canDelete(key: string): boolean {
    const item = this.item(key);
    return !!item && this.canWrite() && item.canDelete && !isPendingKey(key);
  }

  /// Deletes at once (a folder with its subtree) and offers Undo for 8 s (D-82). Resolves with
  /// the removed keys, empty when nothing was deleted.
  async delete(key: string): Promise<string[]> {
    const item = this.item(key);
    if (!item || !this.canDelete(key)) return [];
    const before = this.items();
    const { items, removed } = applyRemove(before, key);
    const nextCursor = this.neighbourOf(key, removed);
    this.items.set(items);
    if (removed.includes(this.cursorKey() ?? '')) this.cursorKey.set(nextCursor);
    try {
      const result = await firstValueFrom(this.api.delete(key));
      this.persist();
      const others = result.deletedCount - 1;
      this.toast.success(
        others > 0
          ? `Deleted "${item.title}" and ${others} ${others === 1 ? 'item' : 'items'} in it`
          : `Deleted "${item.title}"`,
        { action: { label: 'Undo', run: () => void this.restore(key) }, durationMs: 8000 },
      );
      return removed;
    } catch (error) {
      this.items.set(rollback(this.items(), before, key));
      this.toast.error(`Couldn't delete "${item.title}": ${toApiError(error).title}`);
      return [];
    }
  }

  /// Restores a delete group (Undo or the trash) and reloads the tree, since a restore can rename
  /// (" (restored)") or move the group to the root.
  async restore(key: string): Promise<Doc | null> {
    try {
      const doc = await firstValueFrom(this.api.restore(key));
      this.cache.invalidate(docsTreeTag(this.projectKey()));
      await this.reload();
      this.structureVersion.update((v) => v + 1);
      this.reveal(doc.key);
      this.toast.success(`Restored "${doc.title}"`);
      return doc;
    } catch (error) {
      this.toast.error(`Couldn't restore ${key}: ${toApiError(error).title}`);
      return null;
    }
  }

  /// Keeps a doc opened from elsewhere (rename in the page bar, a new version) in sync.
  patchFromDoc(doc: Doc): void {
    if (!this.item(doc.key)) return;
    this.items.update((items) =>
      applyPatch(items, doc.key, {
        title: doc.title,
        version: doc.version,
        updatedAt: doc.updatedAt,
        hasMyDraft: !!doc.myDraft,
        canDelete: doc.permissions.canDelete,
      }),
    );
  }

  private apply(tree: DocTree): void {
    this.items.set(tree.items);
    this.canWrite.set(tree.canWrite);
    this.canManageTrash.set(tree.canManageTrash);
    this.error.set(null);
    this.status.set('loaded');
    const cursor = this.cursorKey();
    if (cursor && !isPendingKey(cursor) && !this.item(cursor)) this.cursorKey.set(null);
  }

  /// A rename or move changes paths and breadcrumbs: cached docs of the project are dropped and
  /// open ones refetch.
  private structureChanged(): void {
    this.cache.invalidate(docsTreeTag(this.projectKey()));
    this.persist();
    this.structureVersion.update((v) => v + 1);
  }

  private persist(): void {
    const projectKey = this.projectKey();
    const items = this.items().filter((i) => !isPendingKey(i.key));
    this.cache.set<DocTree>(
      this.cacheKey(projectKey),
      {
        projectKey,
        myRole: null,
        canWrite: this.canWrite(),
        canManageTrash: this.canManageTrash(),
        total: items.length,
        items,
      },
      [`project:${projectKey}`, docsTreeTag(projectKey)],
    );
  }

  private nodeRows(): NodeRow[] {
    return this.rows().filter((r): r is NodeRow => r.type === 'node');
  }

  private cursorRow(): NodeRow | null {
    return this.nodeRows().find((r) => r.item.key === this.cursorKey()) ?? null;
  }

  private neighbourOf(key: string, removed: readonly string[]): string | null {
    const nodes = this.nodeRows();
    const at = nodes.findIndex((r) => r.item.key === key);
    const gone = new Set(removed);
    const after = nodes.slice(at + 1).find((r) => !gone.has(r.item.key));
    const before = nodes
      .slice(0, Math.max(0, at))
      .reverse()
      .find((r) => !gone.has(r.item.key));
    return (after ?? before)?.item.key ?? null;
  }

  private cacheKey(projectKey: string): string {
    return `docs.tree:${projectKey}`;
  }

  private setExpanded(next: ReadonlySet<string>): void {
    this.expanded.set(next);
    try {
      this.storage?.setItem(EXPANDED_KEY + this.projectKey(), JSON.stringify([...next]));
    } catch {
      return;
    }
  }

  private readExpanded(projectKey: string): ReadonlySet<string> {
    try {
      const raw = this.storage?.getItem(EXPANDED_KEY + projectKey);
      const keys = raw ? (JSON.parse(raw) as unknown) : [];
      return new Set(Array.isArray(keys) ? keys.filter((k) => typeof k === 'string') : []);
    } catch {
      return new Set();
    }
  }
}

export function treeItemOf(doc: Doc, depth: number): DocTreeItem {
  return {
    id: doc.id,
    key: doc.key,
    kind: doc.kind,
    diagramFormat: doc.diagramFormat,
    title: doc.title,
    parentKey: doc.parentKey,
    depth,
    version: doc.version,
    childCount: doc.children?.length ?? 0,
    updatedAt: doc.updatedAt,
    hasMyDraft: !!doc.myDraft,
    canDelete: doc.permissions.canDelete,
  };
}

function pendingItem(key: string, draft: CreateDraft, title: string): DocTreeItem {
  return {
    id: key,
    key,
    kind: draft.kind,
    diagramFormat: draft.diagramFormat,
    title,
    parentKey: draft.parentKey,
    depth: 1,
    version: draft.kind === 'Folder' ? 0 : 1,
    childCount: 0,
    updatedAt: new Date().toISOString(),
    hasMyDraft: false,
    canDelete: false,
  };
}

/// Puts `key`'s subtree back where it was in `before`, keeping any other change made meanwhile
/// (for example a doc created while the move was in flight).
function rollback(
  current: readonly DocTreeItem[],
  before: readonly DocTreeItem[],
  key: string,
): DocTreeItem[] {
  const previous = indexTree(before);
  const original = previous.byKey.get(key);
  if (!original) return [...current];
  const siblings = childrenOf(previous, original.parentKey);
  const at = siblings.findIndex((s) => s.key === key);
  const placement: DocPlacement =
    at > 0
      ? { parent: original.parentKey ?? 'root', afterKey: siblings[at - 1].key }
      : { parent: original.parentKey ?? 'root', position: 'Top' };
  const now = indexTree(current);
  if (now.byKey.has(key)) return applyMove(current, key, placement);
  const subtree = new Set([key, ...descendantsOf(previous, key)]);
  const restored = [...current, ...before.filter((i) => subtree.has(i.key))];
  return applyMove(restored, key, placement);
}
