import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Subject } from 'rxjs';
import { Ticket } from './ticket.models';
import { TicketCache } from './ticket-cache';
import { TicketsApi } from './tickets.api';

function ticket(overrides: Partial<Ticket> = {}): Ticket {
  return {
    id: 't1',
    key: 'WEB-1',
    projectKey: 'WEB',
    priority: 'Medium',
    status: 'ToDo',
    updatedAt: '2026-10-01T10:00:00Z',
    rowVersion: 1,
    comments: [],
    ...overrides,
  } as Ticket;
}

describe('TicketCache', () => {
  let response: Subject<Ticket>;
  let cache: TicketCache;

  beforeEach(() => {
    response = new Subject<Ticket>();
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TicketsApi, useValue: { get: () => response } },
      ],
    });
    cache = TestBed.inject(TicketCache);
  });

  it('keeps an edit saved while a prefetch of the uncached ticket was in flight', async () => {
    // Arrange
    const fetching = cache.fetch('WEB-1');

    // Act: the PATCH answers first, then the GET with the ticket from before it
    cache.merge('WEB-1', {
      priority: 'High',
      updatedAt: '2026-10-01T10:00:05Z',
      rowVersion: 2,
      comments: null,
    } as Partial<Ticket>);
    response.next(ticket());
    response.complete();
    const fetched = await fetching;

    // Assert
    expect(fetched.priority).toBe('High');
    expect(cache.peek('WEB-1')).toEqual(
      expect.objectContaining({ priority: 'High', rowVersion: 2, comments: [] }),
    );
  });

  it('keeps a newer cached copy when a fetch answers with an older one', async () => {
    // Arrange
    cache.put(ticket());
    const fetching = cache.fetch('WEB-1');
    cache.merge('WEB-1', {
      status: 'InProgress',
      updatedAt: '2026-10-01T10:00:05Z',
      rowVersion: 3,
    } as Partial<Ticket>);

    // Act
    response.next(ticket());
    response.complete();
    const fetched = await fetching;

    // Assert
    expect(fetched.status).toBe('InProgress');
    expect(cache.peek('WEB-1')?.rowVersion).toBe(3);
  });

  it('takes a fetch that is newer than the edits merged meanwhile', async () => {
    // Arrange
    const fetching = cache.fetch('WEB-1');
    cache.merge('WEB-1', {
      priority: 'High',
      updatedAt: '2026-10-01T10:00:05Z',
      rowVersion: 2,
    } as Partial<Ticket>);

    // Act
    response.next(ticket({ priority: 'Low', updatedAt: '2026-10-01T10:00:09Z', rowVersion: 4 }));
    response.complete();
    const fetched = await fetching;

    // Assert
    expect(fetched.priority).toBe('Low');
    expect(cache.peek('WEB-1')?.rowVersion).toBe(4);
  });
});
