import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, Subject } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { AttachmentChange, TicketAttachments } from '@core/tickets/ticket-attachments';
import { Comment, Ticket, TicketHistoryPage } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { TicketDetailStore } from './ticket-detail.store';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    key: 'WEB-1',
    projectKey: 'WEB',
    updatedAt: '2026-10-01T10:00:00Z',
    rowVersion: 1,
    comments: [],
    commentCount: 0,
    ...overrides,
  } as Ticket;
}

const comment = (id: string) => ({ id, body: id }) as Comment;

describe('TicketDetailStore', () => {
  let api: {
    get: ReturnType<typeof vi.fn>;
    addComment: ReturnType<typeof vi.fn>;
    history: ReturnType<typeof vi.fn>;
  };
  let attachmentChanges: Subject<AttachmentChange>;
  let store: TicketDetailStore;

  beforeEach(async () => {
    api = {
      get: vi.fn(() => of(ticket({ comments: [comment('c1')], commentCount: 1 }))),
      addComment: vi.fn(() => of(comment('c2'))),
      history: vi.fn(() => of({ items: [], users: [], nextCursor: null } as TicketHistoryPage)),
    };
    attachmentChanges = new Subject();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        TicketDetailStore,
        { provide: TicketsApi, useValue: api },
        { provide: TicketAttachments, useValue: { changes: attachmentChanges } },
        { provide: ToastService, useValue: { error: vi.fn(), success: vi.fn() } },
        { provide: AuthService, useValue: { currentUser: signal(null) } },
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
});
