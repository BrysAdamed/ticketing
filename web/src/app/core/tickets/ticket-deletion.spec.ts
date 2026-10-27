import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ToastService } from '../notify/toast.service';
import { TicketCache } from './ticket-cache';
import { TicketDeletion } from './ticket-deletion';
import { TicketEvent, TicketEvents } from './ticket-events';
import { Ticket } from './ticket.models';
import { TicketsApi } from './tickets.api';

describe('TicketDeletion', () => {
  let api: { delete: ReturnType<typeof vi.fn>; restore: ReturnType<typeof vi.fn> };
  let toast: { success: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };
  let cache: {
    evict: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    fetch: ReturnType<typeof vi.fn>;
  };
  let events: TicketEvent[];
  let deletion: TicketDeletion;

  beforeEach(() => {
    api = { delete: vi.fn(), restore: vi.fn() };
    toast = { success: vi.fn(), error: vi.fn() };
    cache = { evict: vi.fn(), put: vi.fn(), fetch: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: TicketsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: TicketCache, useValue: cache },
      ],
    });
    events = [];
    TestBed.inject(TicketEvents).events.subscribe((e) => events.push(e));
    deletion = TestBed.inject(TicketDeletion);
  });

  it('announces the deletion before the server answers and offers Undo', async () => {
    // Arrange
    api.delete.mockReturnValue(of(undefined));

    // Act
    const pending = deletion.delete(['PAY-1']);
    const announced = [...events];
    await pending;

    // Assert
    expect(announced).toEqual([{ kind: 'deleted', key: 'PAY-1' }]);
    expect(cache.evict).toHaveBeenCalledWith('PAY-1');
    expect(toast.success.mock.calls[0][0]).toBe('PAY-1 deleted');
    expect(toast.success.mock.calls[0][1].action.label).toBe('Undo');
  });

  it('restores on the server when Undo is clicked', async () => {
    // Arrange
    const restored = { key: 'PAY-1', projectKey: 'PAY' } as Ticket;
    api.delete.mockReturnValue(of(undefined));
    api.restore.mockReturnValue(of(restored));
    await deletion.delete(['PAY-1']);

    // Act
    toast.success.mock.calls[0][1].action.run();
    await new Promise((resolve) => setTimeout(resolve));

    // Assert
    expect(api.restore).toHaveBeenCalledWith('PAY-1');
    expect(cache.put).toHaveBeenCalledWith(restored);
    expect(events.at(-1)).toEqual({ kind: 'restored', ticket: restored });
  });

  it('brings a ticket back when the server refuses to delete it', async () => {
    // Arrange
    const ticket = { key: 'PAY-2', projectKey: 'PAY' } as Ticket;
    api.delete.mockReturnValue(throwError(() => new Error('has children')));
    cache.fetch.mockResolvedValue(ticket);

    // Act
    const deleted = await deletion.delete(['PAY-2']);

    // Assert
    expect(deleted).toEqual([]);
    expect(events).toEqual([
      { kind: 'deleted', key: 'PAY-2' },
      { kind: 'restored', ticket },
    ]);
    expect(toast.error).toHaveBeenCalledOnce();
    expect(toast.success).not.toHaveBeenCalled();
  });
});
