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
    const current = this.peek(key);
    if (current) this.put({ ...current, ...stripNulls(update) });
  }

  evict(key: string): void {
    this.entries.delete(key.toUpperCase());
  }

  fetch(key: string): Promise<Ticket> {
    const normalized = key.toUpperCase();
    const pending = this.inFlight.get(normalized);
    if (pending) return pending;
    const request = firstValueFrom(this.api.get(normalized))
      .then((ticket) => {
        this.put(ticket);
        return ticket;
      })
      .finally(() => this.inFlight.delete(normalized));
    this.inFlight.set(normalized, request);
    return request;
  }

  prefetch(key: string): void {
    if (!this.isFresh(key)) void this.fetch(key).catch(() => undefined);
  }
}

/// PATCH responses carry `null` for collections that were not requested; keep the cached ones.
function stripNulls(update: Partial<Ticket>): Partial<Ticket> {
  const collections: (keyof Ticket)[] = ['children', 'childProgress', 'links', 'comments', 'commentCount', 'testCases'];
  const result: Partial<Ticket> = { ...update };
  for (const field of collections) {
    if (result[field] === null || result[field] === undefined) delete result[field];
  }
  return result;
}
