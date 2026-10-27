import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { AttachmentChange, TicketAttachments } from '@core/tickets/ticket-attachments';
import { TicketCache } from '@core/tickets/ticket-cache';
import { TicketDeletion } from '@core/tickets/ticket-deletion';
import { TicketEvent, TicketEvents } from '@core/tickets/ticket-events';
import { Comment, Ticket, TicketHistoryPage, UserRef, Watchers } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { TicketDetailStore } from './ticket-detail.store';

const ME: UserRef = { id: 'u-me', email: 'me@x.test', displayName: 'Mia', isActive: true };
const ANN: UserRef = { id: 'u-ann', email: 'ann@x.test', displayName: 'Ann', isActive: true };

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    key: 'WEB-1',
    projectKey: 'WEB',
    updatedAt: '2026-10-01T10:00:00Z',
    rowVersion: 1,
    comments: [],
    commentCount: 0,
    watchers: { count: 1, watching: false, users: [ANN] },
    ...overrides,
  } as Ticket;
}

const comment = (id: string) => ({ id, body: id }) as Comment;

describe('TicketDetailStore', () => {
  let api: {
    get: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
    watch: ReturnType<typeof vi.fn>;
    unwatch: ReturnType<typeof vi.fn>;
  };
  let attachmentChanges: Subject<AttachmentChange>;
  let toast: { error: ReturnType<typeof vi.fn>; success: ReturnType<typeof vi.fn> };
  let store: TicketDetailStore;

  beforeEach(async () => {
    api = {
      get: vi.fn(() => of(ticket({ comments: [comment('c1')], commentCount: 1 }))),
      addComment: vi.fn(() => of(comment('c2'))),
      history: vi.fn(() => of({ items: [], users: [], nextCursor: null } as TicketHistoryPage)),
      watch: vi.fn(),
      unwatch: vi.fn(),
    };
    attachmentChanges = new Subject();
    toast = { error: vi.fn(), success: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        TicketDetailStore,
        { provide: TicketsApi, useValue: api },
        { provide: TicketAttachments, useValue: { changes: attachmentChanges } },
        { provide: ToastService, useValue: toast },
        { provide: AuthService, useValue: { currentUser: signal(ME) } },
        { provide: TicketDeletion, useValue: { delete: vi.fn() } },
      ],
    });
    store = TestBed.inject(TicketDetailStore);
    await store.load('WEB-1');
  });

  it('takes the new UpdatedAt and row version after a comment, keeping the loaded comments', async () => {
    // Arrange
    api.get.mockReturnValue(
      of(ticket({ updatedAt: '2026-10-02T09:00:00Z', rowVersion: 7, comments: [] })),
    );
    await store.loadHistory();
    api.history.mockClear();

    // Act
    await store.addComment('c2');
    await vi.waitFor(() => expect(store.ticket()?.rowVersion).toBe(7));

    // Assert
    expect(store.ticket()?.updatedAt).toBe('2026-10-02T09:00:00Z');
    expect(store.comments().map((c) => c.id)).toEqual(['c1', 'c2']);
    expect(api.history).toHaveBeenCalledOnce();
  });

  it('refreshes after an attachment change on this ticket only', async () => {
    // Arrange
    api.get.mockClear();
    api.get.mockReturnValue(of(ticket({ updatedAt: '2026-10-03T08:00:00Z', rowVersion: 9 })));

    // Act
    attachmentChanges.next({ kind: 'removed', ticketKey: 'WEB-2', id: 'a1' });
    attachmentChanges.next({ kind: 'removed', ticketKey: 'WEB-1', id: 'a2' });

    // Assert
    await vi.waitFor(() => expect(store.ticket()?.rowVersion).toBe(9));
    expect(api.get).toHaveBeenCalledOnce();
  });

  describe('watching', () => {
    it('shows the user as a watcher at once, then takes the server list into the cache and other views', async () => {
      // Arrange
      const server = new Subject<Watchers>();
      api.watch.mockReturnValue(server);
      const events: TicketEvent[] = [];
      TestBed.inject(TicketEvents).events.subscribe((e) => events.push(e));

      // Act
      const done = store.toggleWatch();

      // Assert: optimistic, ordered by name
      expect(store.ticket()?.watchers).toEqual({ count: 2, watching: true, users: [ANN, ME] });
      expect(api.watch).toHaveBeenCalledWith('WEB-1');

      // Act: the server answers
      const fresh: Watchers = { count: 2, watching: true, users: [ANN, ME] };
      server.next(fresh);
      server.complete();
      await done;

      // Assert
      expect(store.ticket()?.watchers).toBe(fresh);
      expect(TestBed.inject(TicketCache).peek('WEB-1')?.watchers).toBe(fresh);
      expect(events).toEqual([
        { kind: 'updated', ticket: expect.objectContaining({ watchers: fresh }) },
      ]);
    });

    it('rolls back and shows an error toast when unwatching fails', async () => {
      // Arrange
      const watching: Watchers = { count: 2, watching: true, users: [ANN, ME] };
      store.ticket.set(ticket({ watchers: watching }));
      api.unwatch.mockReturnValue(throwError(() => new Error('offline')));

      // Act
      await store.toggleWatch();

      // Assert
      expect(api.unwatch).toHaveBeenCalledWith('WEB-1');
      expect(store.ticket()?.watchers).toEqual(watching);
      expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Couldn't unwatch WEB-1"));
    });

    it('applies only the latest of two quick toggles', async () => {
      // Arrange
      const first = new Subject<Watchers>();
      const unwatched: Watchers = { count: 1, watching: false, users: [ANN] };
      api.watch.mockReturnValue(first);
      api.unwatch.mockReturnValue(of(unwatched));

      // Act
      const watching = store.toggleWatch();
      await store.toggleWatch();
      first.next({ count: 2, watching: true, users: [ANN, ME] });
      first.complete();
      await watching;

      // Assert
      expect(store.ticket()?.watchers).toEqual(unwatched);
    });

    it('takes watchers changed by another view of the same ticket', () => {
      // Arrange
      const fresh: Watchers = { count: 0, watching: false, users: [] };

      // Act
      TestBed.inject(TicketEvents).emit({
        kind: 'updated',
        ticket: ticket({ watchers: fresh }),
      });

      // Assert
      expect(store.ticket()?.watchers).toBe(fresh);
    });
  });
});
