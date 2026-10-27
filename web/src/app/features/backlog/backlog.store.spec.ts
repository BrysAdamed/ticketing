import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { Backlog, BacklogItem, Ticket, TicketSummary } from '@core/tickets/ticket.models';
import { TicketDeletion } from '@core/tickets/ticket-deletion';
import { MoveChildren } from '@core/tickets/move-children';
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
    onBoardsCount: 0,
  };
  update = vi.fn<(key: string, patch?: unknown) => Observable<Ticket>>();
  move = vi.fn<(request: unknown) => Observable<TicketSummary[]>>();
  create = vi.fn<() => Observable<TicketSummary>>();
  backlog = () => of(this.backlogResult);
}

describe('BacklogStore', () => {
  let api: FakeApi;
  let toast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let deletion: { delete: ReturnType<typeof vi.fn> };
  let moveChildren: { ask: ReturnType<typeof vi.fn> };
  let store: BacklogStore;

  beforeEach(async () => {
    api = new FakeApi();
    toast = { error: vi.fn(), success: vi.fn() };
    deletion = { delete: vi.fn().mockResolvedValue([]) };
    moveChildren = { ask: vi.fn().mockResolvedValue({ includeChildren: false, childKeys: [] }) };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        BacklogStore,
        { provide: TicketsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: TicketDeletion, useValue: deletion },
        { provide: MoveChildren, useValue: moveChildren },
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
    response.next({
      id: 'id-2',
      key: 'WEB-2',
      projectKey: 'WEB',
      status: 'Done',
      location: { kind: 'Backlog' },
    } as Ticket);
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
    const response = new Subject<TicketSummary[]>();
    api.move.mockReturnValue(response);

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
      of({
        id: 'id-1',
        key: 'WEB-1',
        projectKey: 'WEB',
        assignee: { id: 'me', email: 'me@x', displayName: 'Me', isActive: true },
        location: { kind: 'Backlog' },
      } as Ticket),
    );

    // Act
    await store.assignToMe(['id-1']);

    // Assert
    expect(store.item('id-1')?.assigneeId).toBe('me');
    expect(store.users().get('me')?.displayName).toBe('Me');
    expect(toast.success.mock.calls[0][0]).toBe('WEB-1 assigned to you');
    expect(toast.success.mock.calls[0][1].action.label).toBe('Undo');
  });

  it('puts each previous assignee back when assign-to-me is undone', async () => {
    // Arrange
    api.backlogResult = {
      ...api.backlogResult,
      items: [item(1, { assigneeId: 'ann' }), item(2)],
    };
    await store.load('WEB');
    api.update.mockImplementation((key: string) =>
      of({
        id: key === 'WEB-1' ? 'id-1' : 'id-2',
        key,
        projectKey: 'WEB',
        assignee: { id: 'me', email: 'me@x', displayName: 'Me', isActive: true },
        location: { kind: 'Backlog' },
      } as Ticket),
    );
    await store.assignToMe(['id-1', 'id-2']);

    // Act
    toast.success.mock.calls[0][1].action.run();
    await flush();

    // Assert
    const patches = api.update.mock.calls.slice(2).map((c) => [c[0], (c as unknown[])[1]]);
    expect(patches).toEqual(
      expect.arrayContaining([
        ['WEB-1', { assignee: 'ann' }],
        ['WEB-2', { assignee: null }],
      ]),
    );
  });

  it('shows quick-created tickets at once and sends them one after another', async () => {
    // Arrange
    const responses = [new Subject<TicketSummary>(), new Subject<TicketSummary>()];
    let calls = 0;
    api.create.mockImplementation(() => responses[calls++]);
    api.move.mockReturnValue(of([]));
    store.groupBy.set('none');
    const row = { kind: 'create' as const, id: 'create:all', groupId: 'all', value: null };

    // Act
    const first = store.quickCreate('First', 'Bug', row);
    const second = store.quickCreate('Second', 'Bug', row);
    const shown = store.visibleItems().map((i) => i.title);
    await flush();
    const callsBeforeFirstAnswer = calls;
    responses[0].next(summary(10, 'First'));
    responses[0].complete();
    await first;
    await flush();
    responses[1].next(summary(11, 'Second'));
    responses[1].complete();
    await second;

    // Assert
    expect(shown.slice(0, 2)).toEqual(['Second', 'First']);
    expect(callsBeforeFirstAnswer).toBe(1);
    expect(calls).toBe(2);
    expect(store.items().map((i) => i.key)).toEqual([
      'WEB-11',
      'WEB-10',
      'WEB-1',
      'WEB-2',
      'WEB-3',
    ]);
    expect(store.items().some((i) => i.id.startsWith('pending:'))).toBe(false);
  });

  it('removes a pending row and offers a retry when quick-create fails', async () => {
    // Arrange
    api.create.mockReturnValue(throwError(() => new Error('down')));
    store.groupBy.set('none');

    // Act
    const created = await store.quickCreate('Lost', 'Bug', {
      kind: 'create',
      id: 'create:all',
      groupId: 'all',
      value: null,
    });

    // Assert
    expect(created).toBeNull();
    expect(store.items().map((i) => i.title)).not.toContain('Lost');
    expect(toast.error.mock.calls[0][1].action.label).toBe('Retry');
  });

  it('deletes through TicketDeletion and moves focus to the next row', async () => {
    // Arrange
    store.focusId.set('id-2');

    // Act
    await store.remove(['id-2']);

    // Assert
    expect(deletion.delete).toHaveBeenCalledWith(['WEB-2']);
    expect(store.focusId()).toBe('id-3');
  });

  it('moves tickets to a board at once and offers Undo', async () => {
    // Arrange
    api.move.mockReturnValue(of([]));

    // Act
    await store.moveToBoard(['id-1', 'id-2'], 'board-1', 'Sprint 42');

    // Assert
    expect(store.items().map((i) => i.key)).toEqual(['WEB-3']);
    expect(api.move).toHaveBeenCalledWith({
      keys: ['WEB-1', 'WEB-2'],
      target: 'board-1',
      from: 'backlog',
    });
    expect(store.onBoardsCount()).toBe(2);
    expect(toast.success.mock.calls[0][0]).toBe('2 tickets moved to Sprint 42');
    expect(toast.success.mock.calls[0][1].action.label).toBe('Undo');
  });

  it('asks about sub-tickets with the loaded child counts and moves them along', async () => {
    // Arrange
    api.backlogResult = {
      ...api.backlogResult,
      items: [item(1, { childCount: 2 }), item(2, { parentId: 'id-1' }), item(3)],
    };
    await store.reload();
    moveChildren.ask.mockResolvedValue({ includeChildren: true, childKeys: ['WEB-2', 'WEB-9'] });
    api.move.mockReturnValue(
      of([summary(1, 'Ticket 1'), summary(2, 'Ticket 2'), summary(9, 'Elsewhere')]),
    );

    // Act
    await store.moveToBoard(['id-1'], 'board-1', 'Sprint 42');

    // Assert
    expect(moveChildren.ask).toHaveBeenCalledWith({
      keys: ['WEB-1'],
      from: 'backlog',
      childCounts: [2],
      source: { kind: 'backlog' },
      destination: { kind: 'board', name: 'Sprint 42' },
    });
    expect(api.move).toHaveBeenCalledWith({
      keys: ['WEB-1'],
      target: 'board-1',
      from: 'backlog',
      includeChildren: true,
    });
    expect(store.items().map((i) => i.key)).toEqual(['WEB-3']);
    expect(store.onBoardsCount()).toBe(3);
    expect(toast.success.mock.calls[0][0]).toBe('WEB-1 moved with 2 sub-tickets to Sprint 42');
  });

  it('brings the sub-ticket rows back when the move fails', async () => {
    // Arrange
    api.backlogResult = {
      ...api.backlogResult,
      items: [item(1, { childCount: 1 }), item(2, { parentId: 'id-1' }), item(3)],
    };
    await store.reload();
    moveChildren.ask.mockResolvedValue({ includeChildren: true, childKeys: ['WEB-2'] });
    const response = new Subject<TicketSummary[]>();
    api.move.mockReturnValue(response);

    // Act
    const moving = store.moveToBoard(['id-1'], 'board-1', 'Sprint 42');
    await flush();
    const during = store.items().map((i) => i.key);
    response.error(new Error('boom'));
    await moving;

    // Assert
    expect(during).toEqual(['WEB-3']);
    expect(store.items().map((i) => i.key)).toEqual(['WEB-1', 'WEB-2', 'WEB-3']);
    expect(toast.error).toHaveBeenCalled();
  });

  it('moves nothing when the sub-ticket question is cancelled', async () => {
    // Arrange
    moveChildren.ask.mockResolvedValue(null);

    // Act
    await store.moveToBoard(['id-1'], 'board-1', 'Sprint 42');

    // Assert
    expect(api.move).not.toHaveBeenCalled();
    expect(store.items()).toHaveLength(3);
  });
});

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

function summary(n: number, title: string): TicketSummary {
  return {
    id: `id-${n}`,
    key: `WEB-${n}`,
    projectKey: 'WEB',
    title,
    type: 'Bug',
    status: 'ToDo',
    priority: 'Medium',
    severity: null,
    assignee: null,
    storyPoints: null,
    labels: [],
    version: null,
    parentKey: null,
    location: { kind: 'Backlog', boardId: null, boardName: null },
    updatedAt: '2026-10-20T00:00:00Z',
    url: '',
    rowVersion: 1,
  };
}
