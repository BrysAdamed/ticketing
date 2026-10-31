import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { SwrCache } from '@core/api/swr-cache';
import { Doc } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { Watchers } from '@core/tickets/ticket.models';
import { DocStore } from './doc.store';

const ME = { id: 'u-me', email: 'me@x.test', displayName: 'Mia', globalRole: 'User' };
const OWEN = { id: 'u-owen', email: 'owen@x.test', displayName: 'Owen', isActive: true };

function doc(watchers: Watchers | null): Doc {
  return { key: 'WEB-D-1', projectKey: 'WEB', kind: 'Page', watchers } as Doc;
}

describe('DocStore watching', () => {
  let api: {
    get: ReturnType<typeof vi.fn>;
    watch: ReturnType<typeof vi.fn>;
    unwatch: ReturnType<typeof vi.fn>;
  };
  let toast: { error: ReturnType<typeof vi.fn> };
  let store: DocStore;

  beforeEach(async () => {
    api = {
      get: vi.fn(() => of(doc({ count: 1, watching: false, users: [OWEN] }))),
      watch: vi.fn(),
      unwatch: vi.fn(),
    };
    toast = { error: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DocStore,
        SwrCache,
        { provide: DocsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: signal(ME) } },
      ],
    });
    store = TestBed.inject(DocStore);
    await store.load('WEB-D-1');
  });

  it('adds me at once and takes the server list', async () => {
    const response = new Subject<Watchers>();
    api.watch.mockReturnValue(response);

    const toggled = store.toggleWatch();
    expect(store.doc()!.watchers).toEqual({
      count: 2,
      watching: true,
      users: [{ id: 'u-me', email: 'me@x.test', displayName: 'Mia', isActive: true }, OWEN],
    });

    response.next({ count: 2, watching: true, users: [OWEN, { ...OWEN, id: 'u-me' }] });
    response.complete();
    await toggled;
    expect(api.watch).toHaveBeenCalledWith('WEB-D-1');
    expect(store.doc()!.watchers!.users.map((u) => u.id)).toEqual(['u-owen', 'u-me']);
  });

  it('rolls back and reports when the server refuses', async () => {
    api.watch.mockReturnValue(throwError(() => new Error('nope')));

    await store.toggleWatch();

    expect(store.doc()!.watchers).toEqual({ count: 1, watching: false, users: [OWEN] });
    expect(toast.error).toHaveBeenCalled();
  });

  it('keeps the optimistic list while a background refresh lands mid-toggle', async () => {
    const response = new Subject<Watchers>();
    api.watch.mockReturnValue(response);

    const toggled = store.toggleWatch();
    await store.refresh();
    expect(store.doc()!.watchers!.watching).toBe(true);

    response.next({ count: 2, watching: true, users: [OWEN] });
    response.complete();
    await toggled;
  });

  it('does nothing for folders', async () => {
    api.get.mockReturnValue(of({ ...doc(null), key: 'WEB-D-2', kind: 'Folder' }));
    await store.load('WEB-D-2');

    await store.toggleWatch();

    expect(api.watch).not.toHaveBeenCalled();
    expect(api.unwatch).not.toHaveBeenCalled();
  });
});
