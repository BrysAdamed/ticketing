import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { DocComment, DocCommentsApi } from '@core/docs/doc-comments.api';
import { ToastService } from '@core/notify/toast.service';
import { DocCommentsStore } from './doc-comments.store';

const ME = { id: 'u-me', email: 'me@x.test', displayName: 'Mia', globalRole: 'User' };

function comment(id: string, overrides: Partial<DocComment> = {}): DocComment {
  return {
    id,
    docKey: 'WEB-D-1',
    author: { id: 'u-me', email: 'me@x.test', displayName: 'Mia', isActive: true },
    body: id,
    createdAt: '2026-10-27T10:00:00Z',
    editedAt: null,
    deleted: false,
    deletedAt: null,
    canEdit: true,
    canDelete: true,
    ...overrides,
  };
}

describe('DocCommentsStore', () => {
  let api: {
    list: ReturnType<typeof vi.fn>;
    add: ReturnType<typeof vi.fn>;
    edit: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn> };
  let deltas: number[];
  let store: DocCommentsStore;

  beforeEach(async () => {
    api = {
      list: vi.fn(() => of({ items: [comment('c1')], nextCursor: null })),
      add: vi.fn(() => of(comment('c2', { body: 'Hello' }))),
      edit: vi.fn((id: string, body: string) =>
        of(comment(id, { body, editedAt: '2026-10-27T11:00:00Z' })),
      ),
      delete: vi.fn((id: string) =>
        of(comment(id, { body: '', deleted: true, canEdit: false, canDelete: false })),
      ),
    };
    toast = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DocCommentsStore,
        { provide: DocCommentsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: signal(ME) } },
      ],
    });
    store = TestBed.inject(DocCommentsStore);
    deltas = [];
    await store.load('WEB-D-1', (delta) => deltas.push(delta));
  });

  it('loads the thread oldest first with the first page size of 100', () => {
    expect(api.list).toHaveBeenCalledWith('WEB-D-1', { limit: 100 });
    expect(store.items().map((c) => c.id)).toEqual(['c1']);
    expect(store.status()).toBe('loaded');
  });

  it('shows an added comment at once as pending and replaces it with the saved one', async () => {
    const response = new Subject<DocComment>();
    api.add.mockReturnValue(response);

    const added = store.add('  Hello  ');
    expect(store.items().map((c) => [c.body, c.pending ?? false])).toEqual([
      ['c1', false],
      ['Hello', true],
    ]);
    expect(store.items()[1].author.displayName).toBe('Mia');
    expect(deltas).toEqual([1]);

    response.next(comment('c2', { body: 'Hello' }));
    response.complete();
    expect(await added).toBe(true);
    expect(api.add).toHaveBeenCalledWith('WEB-D-1', 'Hello');
    expect(store.items().map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(store.items()[1].pending).toBeUndefined();
  });

  it('rolls an add back when the server refuses it', async () => {
    api.add.mockReturnValue(throwError(() => new Error('nope')));

    expect(await store.add('Hello')).toBe(false);

    expect(store.items().map((c) => c.id)).toEqual(['c1']);
    expect(deltas).toEqual([1, -1]);
    expect(toast.error).toHaveBeenCalled();
  });

  it('ignores blank comments', async () => {
    expect(await store.add('   ')).toBe(false);
    expect(api.add).not.toHaveBeenCalled();
  });

  it('edits optimistically, takes the server copy and rolls back on failure', async () => {
    expect(await store.edit('c1', 'Better')).toBe(true);
    expect(store.items()[0]).toMatchObject({ body: 'Better', editedAt: '2026-10-27T11:00:00Z' });

    api.edit.mockReturnValue(throwError(() => new Error('nope')));
    expect(await store.edit('c1', 'Worse')).toBe(false);
    expect(store.items()[0].body).toBe('Better');
    expect(toast.error).toHaveBeenCalled();
  });

  it('does not send an edit that changes nothing', async () => {
    expect(await store.edit('c1', 'c1')).toBe(true);
    expect(api.edit).not.toHaveBeenCalled();
  });

  it('turns a deleted comment into a placeholder and restores it when the delete fails', async () => {
    api.delete.mockReturnValueOnce(throwError(() => new Error('nope')));
    await store.remove('c1');
    expect(store.items()[0]).toMatchObject({ deleted: false, body: 'c1' });
    expect(deltas).toEqual([-1, 1]);

    await store.remove('c1');
    expect(store.items()[0]).toMatchObject({ deleted: true, body: '', canDelete: false });
    expect(deltas).toEqual([-1, 1, -1]);
  });

  it('appends the next page without duplicates', async () => {
    api.list.mockReturnValueOnce(of({ items: [comment('a')], nextCursor: 'next' }));
    await store.load('WEB-D-2');
    api.list.mockReturnValueOnce(of({ items: [comment('a'), comment('b')], nextCursor: null }));

    await store.loadMore();

    expect(api.list).toHaveBeenLastCalledWith('WEB-D-2', { limit: 100, cursor: 'next' });
    expect(store.items().map((c) => c.id)).toEqual(['a', 'b']);
    expect(store.nextCursor()).toBeNull();
  });

  it('drops a slow load of a doc that is no longer shown', async () => {
    const slow = new Subject<{ items: DocComment[]; nextCursor: string | null }>();
    api.list.mockReturnValueOnce(slow);
    const first = store.load('WEB-D-2');
    api.list.mockReturnValueOnce(of({ items: [comment('x')], nextCursor: null }));
    await store.load('WEB-D-3');

    slow.next({ items: [comment('stale')], nextCursor: null });
    slow.complete();
    await first;

    expect(store.items().map((c) => c.id)).toEqual(['x']);
  });

  it('reports a failed load', async () => {
    api.list.mockReturnValueOnce(throwError(() => new Error('down')));
    await store.load('WEB-D-4');
    expect(store.status()).toBe('error');
  });
});
