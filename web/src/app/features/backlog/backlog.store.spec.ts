import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { Backlog, BacklogItem, Ticket } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { BacklogStore } from './backlog.store';

function item(n: number, overrides: Partial<BacklogItem> = {}): BacklogItem {
  return {
    id: `id-${n}`,
    key: `WEB-${n}`,
    title: `Ticket ${n}`,
    type: 'UserStory',
    status: 'ToDo',
    priority: 'Medium',
    severity: null,
    storyPoints: null,
    version: null,
    labels: [],
    assigneeId: null,
    parentId: null,
    updatedAt: '2026-10-20T00:00:00Z',
    childCount: 0,
    childDoneCount: 0,
    commentCount: 0,
    testCaseCount: 0,
    ...overrides,
  };
}

class FakeApi {
  backlogResult: Backlog = {
    projectId: 'p',
    projectKey: 'WEB',
    canWrite: true,
    items: [item(1), item(2), item(3)],
    users: [],
    parents: [],
    truncated: false,
  };
  update = vi.fn<(key: string) => Observable<Ticket>>();
  rank = vi.fn<() => Observable<void>>();
  backlog = () => of(this.backlogResult);
}

describe('BacklogStore', () => {
  let api: FakeApi;
  let toast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let store: BacklogStore;

  beforeEach(async () => {
    api = new FakeApi();
    toast = { error: vi.fn(), success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BacklogStore,
        { provide: TicketsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'me', email: 'me@x', displayName: 'Me', globalRole: 'User' }),
          },
        },
      ],
    });
    store = TestBed.inject(BacklogStore);
    await store.load('WEB');
  });

  it('hides a ticket set to Done immediately and keeps it when the server agrees', async () => {
    // Arrange
    const response = new Subject<Ticket>();
    api.update.mockReturnValue(response);

    // Act
    const pending = store.setStatus(['id-2'], 'Done');

    // Assert
    expect(store.visibleItems().map((i) => i.key)).toEqual(['WEB-1', 'WEB-3']);
    response.next({ key: 'WEB-2', projectKey: 'WEB', location: { kind: 'Backlog' } } as Ticket);
    response.complete();
    await pending;
    expect(store.item('id-2')?.status).toBe('Done');
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rolls an edit back and offers a retry when the server rejects it', async () => {
    // Arrange
    api.update.mockReturnValue(throwError(() => new Error('boom')));

    // Act
    await store.setPriority(['id-1'], 'Highest');

    // Assert
    expect(store.item('id-1')?.priority).toBe('Medium');
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.error.mock.calls[0][1].action.label).toBe('Retry');
  });

  it('reorders optimistically and restores the order when ranking fails', async () => {
    // Arrange
    const response = new Subject<void>();
    api.rank.mockReturnValue(response);

    // Act
    const pending = store.rank(['id-3'], { beforeKey: 'WEB-1' }, { beforeId: 'id-1' });
    const optimistic = store.items().map((i) => i.key);
    response.error(new Error('conflict'));
    await pending;

    // Assert
    expect(optimistic).toEqual(['WEB-3', 'WEB-1', 'WEB-2']);
    expect(store.items().map((i) => i.key)).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it('assigns the focused ticket to the current user', async () => {
    // Arrange
    api.update.mockReturnValue(
      of({ key: 'WEB-1', projectKey: 'WEB', location: { kind: 'Backlog' } } as Ticket),
    );

    // Act
    await store.assignToMe(['id-1']);

    // Assert
    expect(store.item('id-1')?.assigneeId).toBe('me');
    expect(store.users().get('me')?.displayName).toBe('Me');
  });
});
