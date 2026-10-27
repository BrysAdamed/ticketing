import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { ApiError } from '@core/api/api-error';
import { SwrCache } from '@core/api/swr-cache';
import { DeletedDoc, Doc, DocTree, DocTreeItem } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { DocTreeStore } from './doc-tree.store';

function item(key: string, parentKey: string | null, kind: DocTreeItem['kind'] = 'Page') {
  return {
    id: `id-${key}`,
    key,
    kind,
    diagramFormat: null,
    title: key,
    parentKey,
    depth: parentKey ? 2 : 1,
    version: kind === 'Folder' ? 0 : 1,
    childCount: 0,
    updatedAt: '2026-10-27T10:00:00Z',
    hasMyDraft: false,
    canDelete: true,
  } satisfies DocTreeItem;
}

function doc(key: string, overrides: Partial<Doc> = {}): Doc {
  const user = { id: 'u', email: 'u@x', displayName: 'U', isActive: true };
  return {
    id: `id-${key}`,
    key,
    projectId: 'p',
    projectKey: 'WEB',
    kind: 'Page',
    diagramFormat: null,
    title: key,
    path: key,
    parentKey: null,
    breadcrumb: [],
    content: '',
    version: 1,
    createdBy: user,
    createdAt: '2026-10-27T10:00:00Z',
    updatedBy: user,
    updatedAt: '2026-10-27T10:00:00Z',
    myRole: 'Owner',
    permissions: { canEdit: true, canDelete: true },
    editors: [],
    myDraft: null,
    children: null,
    url: `/p/WEB/docs/${key}/x`,
    rowVersion: 1,
    references: { tickets: [], docs: [] },
    embeds: [],
    backlinks: { total: 0, items: [] },
    ...overrides,
  };
}

function conflict(code: string): ApiError {
  return new ApiError(409, code, `Refused: ${code}`);
}

class FakeApi {
  treeResult: DocTree = {
    projectKey: 'WEB',
    myRole: 'Owner',
    canWrite: true,
    canManageTrash: true,
    total: 4,
    items: [
      { ...item('WEB-D-1', null, 'Folder'), childCount: 1 },
      item('WEB-D-2', 'WEB-D-1'),
      item('WEB-D-3', null),
      item('WEB-D-4', null, 'Folder'),
    ],
  };
  tree = vi.fn(() => of(this.treeResult));
  move = vi.fn<(key: string, placement: unknown) => Observable<Doc>>();
  rename = vi.fn<(key: string, title: string) => Observable<Doc>>();
  create = vi.fn<(projectKey: string, body: unknown, key?: string) => Observable<Doc>>();
  delete = vi.fn<(key: string) => Observable<DeletedDoc>>();
  restore = vi.fn<(key: string) => Observable<Doc>>();
  duplicate = vi.fn<(key: string) => Observable<Doc>>();
}

describe('DocTreeStore', () => {
  let api: FakeApi;
  let toast: Record<'success' | 'error' | 'warning', ReturnType<typeof vi.fn>>;
  let store: DocTreeStore;

  const order = () => store.items().map((i) => `${i.key}:${i.parentKey ?? '-'}`);

  beforeEach(async () => {
    localStorage.clear();
    api = new FakeApi();
    toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DocTreeStore,
        { provide: DocsApi, useValue: api },
        { provide: ToastService, useValue: toast },
      ],
    });
    TestBed.inject(SwrCache).clear();
    store = TestBed.inject(DocTreeStore);
    await store.load('WEB');
  });

  it('moves at once and keeps the move when the server agrees', async () => {
    // Arrange
    const response = new Subject<Doc>();
    api.move.mockReturnValue(response);

    // Act
    const moving = store.move('WEB-D-3', { parent: 'WEB-D-1', position: 'Bottom' });

    // Assert: optimistic before the server answers
    expect(order()).toEqual(['WEB-D-1:-', 'WEB-D-2:WEB-D-1', 'WEB-D-3:WEB-D-1', 'WEB-D-4:-']);
    expect(store.expanded().has('WEB-D-1')).toBe(true);
    response.next(doc('WEB-D-3', { parentKey: 'WEB-D-1' }));
    response.complete();
    expect(await moving).toBe(true);
    expect(api.move).toHaveBeenCalledWith('WEB-D-3', { parent: 'WEB-D-1', position: 'Bottom' });
  });

  it('rolls a refused move back to its old place with a toast', async () => {
    // Arrange
    api.move.mockReturnValue(throwError(() => conflict('doc.title.duplicate')));

    // Act
    const moved = await store.move('WEB-D-3', { parent: 'WEB-D-4', position: 'Bottom' });

    // Assert
    expect(moved).toBe(false);
    expect(order()).toEqual(['WEB-D-1:-', 'WEB-D-2:WEB-D-1', 'WEB-D-3:-', 'WEB-D-4:-']);
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Refused'));
  });

  it('refuses an invalid move locally without calling the server', async () => {
    // Act
    const intoPage = await store.move('WEB-D-3', { parent: 'WEB-D-2' });
    const intoItself = await store.move('WEB-D-1', { parent: 'WEB-D-1' });

    // Assert
    expect(intoPage).toBe(false);
    expect(intoItself).toBe(false);
    expect(api.move).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalledTimes(2);
  });

  it('keeps a doc created meanwhile when rolling a move back', async () => {
    // Arrange
    const move = new Subject<Doc>();
    api.move.mockReturnValue(move);
    api.create.mockReturnValue(of(doc('WEB-D-9', { title: 'New one' })));
    const moving = store.move('WEB-D-3', { parent: 'WEB-D-4' });
    store.startCreate('Page', null);
    await store.submitCreate('New one');

    // Act
    move.error(conflict('doc.tree.depth'));
    await moving;

    // Assert
    expect(order()).toEqual([
      'WEB-D-1:-',
      'WEB-D-2:WEB-D-1',
      'WEB-D-3:-',
      'WEB-D-4:-',
      'WEB-D-9:-',
    ]);
  });

  it('shows a pending row while creating and replaces it with the server node', async () => {
    // Arrange
    const response = new Subject<Doc>();
    api.create.mockReturnValue(response);
    store.startCreate('Folder', 'WEB-D-4');

    // Act
    const creating = store.submitCreate('Specs');

    // Assert
    expect(store.items().at(-1)?.key).toMatch(/^pending-/);
    expect(store.items().at(-1)?.parentKey).toBe('WEB-D-4');
    response.next(doc('WEB-D-5', { kind: 'Folder', title: 'Specs', parentKey: 'WEB-D-4' }));
    response.complete();
    expect((await creating)?.key).toBe('WEB-D-5');
    expect(store.items().at(-1)?.key).toBe('WEB-D-5');
    expect(store.cursorKey()).toBe('WEB-D-5');
    expect(api.create.mock.calls[0][1]).toEqual({
      kind: 'Folder',
      title: 'Specs',
      parent: 'WEB-D-4',
    });
  });

  it('refuses a duplicate title before creating', async () => {
    // Arrange
    store.startCreate('Page', 'WEB-D-1');

    // Act
    const created = await store.submitCreate('web-d-2');

    // Assert
    expect(created).toBeNull();
    expect(store.titleProblem('WEB-D-2', 'WEB-D-1')).toContain('already exists');
    expect(api.create).not.toHaveBeenCalled();
  });

  it('renames optimistically and restores the old title when the server refuses', async () => {
    // Arrange
    api.rename.mockReturnValue(throwError(() => conflict('doc.title.duplicate')));

    // Act
    const pending = store.submitRename('WEB-D-3', 'Runbook');
    const during = store.item('WEB-D-3')?.title;
    await pending;

    // Assert
    expect(during).toBe('Runbook');
    expect(store.item('WEB-D-3')?.title).toBe('WEB-D-3');
    expect(toast.error).toHaveBeenCalled();
  });

  it('deletes a folder with its subtree at once and offers Undo that restores it', async () => {
    // Arrange
    api.delete.mockReturnValue(
      of({ id: 'id', key: 'WEB-D-1', deletedCount: 2, deletedAt: '', undoUntil: '' }),
    );
    api.restore.mockReturnValue(of(doc('WEB-D-1', { kind: 'Folder' })));

    // Act
    const removed = await store.delete('WEB-D-1');

    // Assert
    expect(removed.sort()).toEqual(['WEB-D-1', 'WEB-D-2']);
    expect(order()).toEqual(['WEB-D-3:-', 'WEB-D-4:-']);
    const [message, options] = toast.success.mock.calls[0];
    expect(message).toBe('Deleted "WEB-D-1" and 1 item in it');
    options.action.run();
    await vi.waitFor(() => expect(store.item('WEB-D-2')).not.toBeNull());
    expect(api.restore).toHaveBeenCalledWith('WEB-D-1');
  });

  it('brings a doc back when the delete fails', async () => {
    // Arrange
    api.delete.mockReturnValue(throwError(() => conflict('doc.folder.notEmpty')));

    // Act
    await store.delete('WEB-D-1');

    // Assert
    expect(order()).toEqual(['WEB-D-1:-', 'WEB-D-2:WEB-D-1', 'WEB-D-3:-', 'WEB-D-4:-']);
    expect(toast.error).toHaveBeenCalled();
  });

  it('remembers expanded folders per project', async () => {
    // Arrange
    store.toggle('WEB-D-1', true);

    // Act
    const other = TestBed.runInInjectionContext(() => new DocTreeStore());
    await other.load('WEB');

    // Assert
    expect(other.expanded().has('WEB-D-1')).toBe(true);
  });

  it('shows the cached tree at once on a revisit and revalidates it', async () => {
    // Arrange
    const fresh = new Subject<DocTree>();
    api.tree.mockReturnValue(fresh);
    const revisit = TestBed.runInInjectionContext(() => new DocTreeStore());

    // Act
    const loading = revisit.load('WEB');

    // Assert
    expect(revisit.status()).toBe('loaded');
    expect(revisit.items()).toHaveLength(4);
    fresh.next({ ...api.treeResult, items: api.treeResult.items.slice(0, 1) });
    fresh.complete();
    await loading;
    expect(revisit.items()).toHaveLength(1);
  });

  it('moves the cursor through visible rows and into folders with the arrow keys', () => {
    // Act
    store.step(1);
    const first = store.cursorKey();
    store.expandOrEnter();
    store.expandOrEnter();
    const inside = store.cursorKey();
    store.collapseOrLeave();
    const back = store.cursorKey();

    // Assert
    expect(first).toBe('WEB-D-1');
    expect(inside).toBe('WEB-D-2');
    expect(back).toBe('WEB-D-1');
  });
});
