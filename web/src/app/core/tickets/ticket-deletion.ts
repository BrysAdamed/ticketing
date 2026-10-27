import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '../api/api-error';
import { ToastService } from '../notify/toast.service';
import { TicketCache } from './ticket-cache';
import { TicketEvents } from './ticket-events';
import { TicketsApi } from './tickets.api';

/// Ticket deletion without a confirm dialog (D-82): the tickets disappear at once (a `deleted`
/// event per key, so lists drop them and an open peek closes), the DELETEs run in the background,
/// and a toast offers Undo, which restores them on the server (`POST /tickets/{key}/restore`).
/// A ticket the server refuses to delete comes back through a `restored` event.
@Injectable({ providedIn: 'root' })
export class TicketDeletion {
  private readonly api = inject(TicketsApi);
  private readonly cache = inject(TicketCache);
  private readonly events = inject(TicketEvents);
  private readonly toast = inject(ToastService);

  /// Resolves with the keys the server deleted.
  async delete(keys: readonly string[]): Promise<string[]> {
    if (keys.length === 0) return [];
    for (const key of keys) this.events.emit({ kind: 'deleted', key });
    const results = await Promise.allSettled(
      keys.map((key) => firstValueFrom(this.api.delete(key))),
    );
    const deleted = keys.filter((_, i) => results[i].status === 'fulfilled');
    const failed = keys.filter((_, i) => results[i].status === 'rejected');
    for (const key of deleted) this.cache.evict(key);
    if (failed.length) {
      await this.bringBack(failed);
      const reason = (results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason;
      this.toast.error(`${failed.join(', ')} not deleted: ${toApiError(reason).title}`);
    } else {
      this.toast.success(
        deleted.length === 1 ? `${deleted[0]} deleted` : `${deleted.length} tickets deleted`,
        { action: { label: 'Undo', run: () => void this.restore(deleted) } },
      );
    }
    return deleted;
  }

  async restore(keys: readonly string[]): Promise<void> {
    const results = await Promise.allSettled(
      keys.map((key) => firstValueFrom(this.api.restore(key))),
    );
    results.forEach((result) => {
      if (result.status !== 'fulfilled') return;
      this.cache.put(result.value);
      this.events.emit({ kind: 'restored', ticket: result.value });
    });
    const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
    if (failed) this.toast.error(`Couldn't restore: ${toApiError(failed.reason).title}`);
    else
      this.toast.success(keys.length === 1 ? `${keys[0]} restored` : `${keys.length} tickets restored`);
  }

  private async bringBack(keys: readonly string[]): Promise<void> {
    await Promise.allSettled(
      keys.map(async (key) => {
        const ticket = await this.cache.fetch(key);
        this.events.emit({ kind: 'restored', ticket });
      }),
    );
  }
}
