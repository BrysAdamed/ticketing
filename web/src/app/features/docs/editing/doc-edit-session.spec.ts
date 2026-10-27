import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '@core/api/api-error';
import { Doc, DocDraft, DocVersion, SaveDocDraft, UpdateDoc } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { DocStore } from '../doc/doc.store';
import { AUTOSAVE_DELAY_MS, DocEditSession } from './doc-edit-session';

const jane = { id: 'jane', email: 'jane@x', displayName: 'Jane Doe', isActive: true };

function doc(overrides: Partial<Doc> = {}): Doc {
  const user = { id: 'me', email: 'me@x', displayName: 'Me', isActive: true };
  return {
    id: 'id-1',
    key: 'WEB-D-1',
    projectId: 'p',
    projectKey: 'WEB',
    kind: 'Page',
    diagramFormat: null,
    title: 'Payment flow',
    path: 'Payment flow',
    parentKey: null,
    breadcrumb: [],
    content: 'one\n\ntwo\n\nthree',
    version: 3,
    createdBy: user,
    createdAt: '2026-10-27T10:00:00Z',
    updatedBy: user,
    updatedAt: '2026-10-27T10:00:00Z',
    myRole: 'Owner',
    permissions: { canEdit: true, canDelete: true },
    editors: [],
    myDraft: null,
    children: null,
    url: '/p/WEB/docs/WEB-D-1/payment-flow',
    rowVersion: 1,
    commentCount: 0,
    references: { tickets: [], docs: [] },
    embeds: [],
    backlinks: { total: 0, items: [] },
    ...overrides,
  };
}

function draft(overrides: Partial<DocDraft> = {}): DocDraft {
  return {
    docKey: 'WEB-D-1',
    baseVersion: 3,
    currentVersion: 3,
    title: 'Payment flow',
    content: 'draft text',
    createdAt: '2026-10-27T10:00:00Z',
    updatedAt: '2026-10-27T10:05:00Z',
    ...overrides,
  };
}

const conflict = () => new ApiError(409, 'doc.version.conflict', 'Stale');

class FakeApi {
  draft = vi.fn(() => of(draft()));
  saveDraft = vi.fn((_key: string, body: SaveDocDraft) => of(draft({ ...body })));
  saveDraftOnUnload = vi.fn();
  discardDraft = vi.fn(() => of(undefined));
  update = vi.fn((_key: string, body: UpdateDoc) =>
    of(doc({ content: body.content ?? '', title: body.title ?? 'Payment flow', version: 4 })),
  );
  get = vi.fn(() => of(doc()));
  version = vi.fn((_key: string, number: number): ReturnType<DocsApi['version']> =>
    of({
      docKey: 'WEB-D-1',
      number,
      title: 'Payment flow',
      content: 'one\n\ntwo\n\nthree',
      changeNote: null,
      author: jane,
      channel: 'Web',
      createdAt: '2026-10-27T10:00:00Z',
      restoredFrom: null,
    } satisfies DocVersion),
  );
}

class FakeStore {
  doc = signal<Doc | null>(doc());
  set = vi.fn((value: Doc) => this.doc.set(value));
  refresh = vi.fn(() => Promise.resolve());
}

describe('DocEditSession', () => {
  let api: FakeApi;
  let store: FakeStore;
  let toast: {
    success: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };
  let session: DocEditSession;

  beforeEach(() => {
    vi.useFakeTimers();
    api = new FakeApi();
    store = new FakeStore();
    toast = { success: vi.fn(), error: vi.fn(), warning: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DocEditSession,
        { provide: DocsApi, useValue: api },
        { provide: DocStore, useValue: store },
        { provide: ToastService, useValue: toast },
      ],
    });
    session = TestBed.inject(DocEditSession);
  });

  afterEach(() => vi.useRealTimers());

  it('starts from the published text when I have no draft', async () => {
    // Act
    await session.open(doc());

    // Assert
    expect(api.draft).not.toHaveBeenCalled();
    expect(session.content()).toBe('one\n\ntwo\n\nthree');
    expect(session.baseVersion()).toBe(3);
    expect(session.status()).toBe('clean');
  });

  it('continues my draft with its base version', async () => {
    // Arrange
    api.draft.mockReturnValue(of(draft({ baseVersion: 2, title: '', content: 'wip' })));

    // Act
    await session.open(doc({ myDraft: { baseVersion: 2, updatedAt: '2026-10-27T10:05:00Z' } }));

    // Assert
    expect(session.content()).toBe('wip');
    expect(session.title()).toBe('Payment flow');
    expect(session.baseVersion()).toBe(2);
    expect(session.status()).toBe('saved');
  });

  it('autosaves once, 1 s after the last change, and marks the doc as having my draft', async () => {
    // Arrange
    await session.open(doc());

    // Act
    session.edit({ content: 'one!' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    session.edit({ content: 'one!!' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS - 100);
    const before = api.saveDraft.mock.calls.length;
    await vi.advanceTimersByTimeAsync(200);

    // Assert
    expect(before).toBe(0);
    expect(api.saveDraft).toHaveBeenCalledTimes(1);
    expect(api.saveDraft).toHaveBeenCalledWith('WEB-D-1', {
      baseVersion: 3,
      title: 'Payment flow',
      content: 'one!!',
    });
    expect(session.status()).toBe('saved');
    expect(store.doc()?.myDraft?.baseVersion).toBe(3);
  });

  it('reports a failed save and retries on flush', async () => {
    // Arrange
    await session.open(doc());
    api.saveDraft.mockReturnValueOnce(throwError(() => new ApiError(0, 'network', 'Offline')));

    // Act
    session.edit({ content: 'x' });
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    const afterFailure = session.status();
    await session.flush();

    // Assert
    expect(afterFailure).toBe('error');
    expect(api.saveDraft).toHaveBeenCalledTimes(2);
    expect(session.status()).toBe('saved');
  });

  it('saves with a keepalive request when the page unloads with unsaved changes', async () => {
    // Arrange
    await session.open(doc());
    session.edit({ content: 'typed' });

    // Act
    session.saveOnUnload();

    // Assert
    expect(api.saveDraftOnUnload).toHaveBeenCalledWith('WEB-D-1', {
      baseVersion: 3,
      title: 'Payment flow',
      content: 'typed',
    });
  });

  it('publishes against the base version and sends the title only when it changed', async () => {
    // Arrange
    await session.open(doc());
    session.edit({ content: 'one\n\nTWO\n\nthree' });

    // Act
    const published = await session.publish('Fix two');

    // Assert
    expect(api.update).toHaveBeenCalledWith('WEB-D-1', {
      title: undefined,
      content: 'one\n\nTWO\n\nthree',
      baseVersion: 3,
      changeNote: 'Fix two',
    });
    expect(published?.version).toBe(4);
    expect(session.status()).toBe('published');
    expect(session.baseVersion()).toBe(4);
    expect(store.set).toHaveBeenCalledWith(published);
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS * 2);
    expect(api.saveDraft).not.toHaveBeenCalled();
  });

  it('refuses to publish without a title', async () => {
    // Arrange
    await session.open(doc());
    session.edit({ title: '  ' });

    // Act
    const published = await session.publish();

    // Assert
    expect(published).toBeNull();
    expect(api.update).not.toHaveBeenCalled();
    expect(toast.warning).toHaveBeenCalled();
  });

  it('merges non-overlapping concurrent edits, publishes the merge and says so', async () => {
    // Arrange
    await session.open(doc());
    session.edit({ content: 'ONE\n\ntwo\n\nthree' });
    api.update.mockReturnValueOnce(throwError(conflict));
    api.get.mockReturnValue(
      of(doc({ content: 'one\n\ntwo\n\nTHREE', version: 4, updatedBy: jane, title: 'Renamed' })),
    );
    api.update.mockReturnValueOnce(of(doc({ content: 'ONE\n\ntwo\n\nTHREE', version: 5 })));

    // Act
    const published = await session.publish();

    // Assert
    expect(api.version).toHaveBeenCalledTimes(0);
    expect(api.update).toHaveBeenLastCalledWith('WEB-D-1', {
      title: undefined,
      content: 'ONE\n\ntwo\n\nTHREE',
      baseVersion: 4,
      changeNote: null,
    });
    expect(published?.version).toBe(5);
    expect(session.content()).toBe('ONE\n\ntwo\n\nTHREE');
    expect(toast.success).toHaveBeenCalledWith("Merged with Jane Doe's changes (v4)");
  });

  it('fetches the base version it started from when it is not the one loaded', async () => {
    // Arrange
    api.draft.mockReturnValue(of(draft({ baseVersion: 2, content: 'one\n\ntwo\n\nthree!' })));
    await session.open(doc({ myDraft: { baseVersion: 2, updatedAt: '2026-10-27T10:05:00Z' } }));
    api.update.mockReturnValueOnce(throwError(conflict));

    // Act
    await session.publish();

    // Assert
    expect(api.version).toHaveBeenCalledWith('WEB-D-1', 2);
  });

  it('opens the conflict view for overlapping edits and resolves it three ways', async () => {
    // Arrange
    await session.open(doc());
    session.edit({ content: 'one\n\nmine\n\nthree' });
    api.update.mockReturnValueOnce(throwError(conflict));
    const theirs = doc({ content: 'one\n\ntheirs\n\nthree', version: 4, updatedBy: jane });
    api.get.mockReturnValue(of(theirs));

    // Act
    const published = await session.publish();

    // Assert
    expect(published).toBeNull();
    expect(session.status()).toBe('conflict');
    expect(session.conflict()?.theirs.version).toBe(4);
    expect(session.conflict()?.regions).toEqual([
      { mine: { start: 2, end: 3 }, theirs: { start: 2, end: 3 } },
    ]);

    // Act: keep editing on latest
    session.keepEditingOnLatest();

    // Assert
    expect(session.content()).toBe('one\n\ntheirs\n\nthree');
    expect(session.reference()?.content).toBe('one\n\nmine\n\nthree');
    expect(session.baseVersion()).toBe(4);
    expect(session.conflict()).toBeNull();
  });

  it('overwrites with mine against the latest version', async () => {
    // Arrange
    await session.open(doc());
    session.edit({ content: 'one\n\nmine\n\nthree' });
    api.update.mockReturnValueOnce(throwError(conflict));
    api.get.mockReturnValue(of(doc({ content: 'one\n\ntheirs\n\nthree', version: 4 })));
    await session.publish();

    // Act
    const published = await session.overwriteWithMine('Mine wins');

    // Assert
    expect(api.update).toHaveBeenLastCalledWith('WEB-D-1', {
      title: undefined,
      content: 'one\n\nmine\n\nthree',
      baseVersion: 4,
      changeNote: 'Mine wins',
    });
    expect(published).not.toBeNull();
    expect(session.conflict()).toBeNull();
  });

  it('without a text merge, shows the conflict at once and overwrites with mine plus its picture', async () => {
    // Arrange
    const attach = vi.fn((content: string) =>
      Promise.resolve({ snapshot: `<svg>${content}</svg>` }),
    );
    session.configure({ textMerge: false, attach });
    await session.open(doc());
    session.edit({ content: 'one\n\nmine\n\nfour' });
    api.update.mockReturnValueOnce(throwError(conflict));
    api.get.mockReturnValue(
      of(doc({ content: 'zero\n\ntwo\n\nthree', version: 4, updatedBy: jane })),
    );

    // Act
    const first = await session.publish();

    // Assert
    expect(first).toBeNull();
    expect(api.version).not.toHaveBeenCalled();
    expect(session.status()).toBe('conflict');
    expect(session.conflict()?.theirs.version).toBe(4);
    expect(session.conflict()?.regions).toEqual([]);

    // Act: overwrite with mine
    const published = await session.overwriteWithMine();

    // Assert
    expect(api.update).toHaveBeenLastCalledWith('WEB-D-1', {
      snapshot: '<svg>one\n\nmine\n\nfour</svg>',
      title: undefined,
      content: 'one\n\nmine\n\nfour',
      baseVersion: 4,
      changeNote: null,
    });
    expect(published).not.toBeNull();
    expect(attach).toHaveBeenCalledTimes(2);
  });

  it('discards my draft and clears the marker on the doc', async () => {
    // Arrange
    store.doc.set(doc({ myDraft: { baseVersion: 3, updatedAt: '2026-10-27T10:05:00Z' } }));
    await session.open(store.doc()!);

    // Act
    const closed = await session.discard();

    // Assert
    expect(closed).toBe(true);
    expect(api.discardDraft).toHaveBeenCalledWith('WEB-D-1');
    expect(store.doc()?.myDraft).toBeNull();
  });
});
