import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { Ticket } from './ticket.models';
import { TicketsApi } from './tickets.api';

const MAX_ENTRIES = 200;
const FRESH_MS = 30_000;

interface Entry {
  ticket: Ticket;
  fetchedAt: number;
}

/// Recently seen tickets by key, so the ticket view renders instantly (stale-while-revalidate) and
/// list rows can prefetch on hover (layout-and-screens §2, "Performance budget").
@Injectable({ providedIn: 'root' })
export class TicketCache {
  private readonly api = inject(TicketsApi);
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<Ticket>>();
  /// Updates merged while the ticket was not cached but being fetched: the fetch may answer with the
  /// ticket from before them.
  private readonly lateUpdates = new Map<string, Partial<Ticket>>();

  peek(key: string): Ticket | null {
    return this.entries.get(key.toUpperCase())?.ticket ?? null;
  }

  isFresh(key: string): boolean {
    const entry = this.entries.get(key.toUpperCase());
    return !!entry && Date.now() - entry.fetchedAt < FRESH_MS;
  }

  put(ticket: Ticket): void {
    const key = ticket.key.toUpperCase();
    this.entries.delete(key);
    this.entries.set(key, { ticket, fetchedAt: Date.now() });
    if (this.entries.size > MAX_ENTRIES) {
      const oldest = this.entries.keys().next().value;
      if (oldest) this.entries.delete(oldest);
    }
  }

  /// Merges a partial update (for example a PATCH response without collections) into the cached ticket.
  merge(key: string, update: Partial<Ticket>): void {
    const normalized = key.toUpperCase();
    const current = this.peek(normalized);
    if (current) this.put({ ...current, ...stripNulls(update) });
    else if (this.inFlight.has(normalized))
      this.lateUpdates.set(normalized, {
        ...this.lateUpdates.get(normalized),
        ...stripNulls(update),
      });
  }

  evict(key: string): void {
    this.entries.delete(key.toUpperCase());
  }

  /// Loads the ticket into the cache. An answer older than what the cache learned meanwhile (a PATCH
  /// response merged while the request was in flight) does not replace it.
  fetch(key: string): Promise<Ticket> {
    const normalized = key.toUpperCase();
    const pending = this.inFlight.get(normalized);
    if (pending) return pending;
    const request = firstValueFrom(this.api.get(normalized))
      .then((fetched) => {
        const late = this.lateUpdates.get(normalized);
        const withLate = late && isLater(late, fetched) ? { ...fetched, ...late } : fetched;
        const cached = this.peek(normalized);
        const ticket = cached && isLater(cached, withLate) ? cached : withLate;
        this.put(ticket);
        return ticket;
      })
      .finally(() => {
        this.inFlight.delete(normalized);
        this.lateUpdates.delete(normalized);
      });
    this.inFlight.set(normalized, request);
    return request;
  }

  prefetch(key: string): void {
    if (!this.isFresh(key)) void this.fetch(key).catch(() => undefined);
  }
}

/// The server saved `candidate` after `than`: another row version and a later `updatedAt`.
function isLater(candidate: Partial<Ticket>, than: Ticket): boolean {
  return (
    candidate.rowVersion !== undefined &&
    candidate.rowVersion !== than.rowVersion &&
    candidate.updatedAt !== undefined &&
    Date.parse(candidate.updatedAt) > Date.parse(than.updatedAt)
  );
}

/// PATCH responses carry `null` for collections that were not requested; keep the cached ones.
function stripNulls(update: Partial<Ticket>): Partial<Ticket> {
  const collections: (keyof Ticket)[] = [
    'children',
    'childProgress',
    'links',
    'comments',
    'commentCount',
    'testCases',
    'watchers',
  ];
  const result: Partial<Ticket> = { ...update };
  for (const field of collections) {
    if (result[field] === null || result[field] === undefined) delete result[field];
  }
  return result;
}
