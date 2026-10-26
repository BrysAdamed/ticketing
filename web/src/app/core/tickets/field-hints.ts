import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { HintField } from './ticket.models';
import { TicketsApi } from './tickets.api';

/// Version and label suggestions (spec 6.7) per project, field and prefix, cached for the session.
@Injectable({ providedIn: 'root' })
export class FieldHints {
  private readonly api = inject(TicketsApi);
  private readonly cache = new Map<string, Promise<string[]>>();

  get(projectKey: string, field: HintField, prefix = ''): Promise<string[]> {
    const key = `${projectKey.toUpperCase()}|${field}|${prefix.trim().toLowerCase()}`;
    let entry = this.cache.get(key);
    if (!entry) {
      entry = firstValueFrom(this.api.hints(projectKey, field, prefix.trim())).catch(() => {
        this.cache.delete(key);
        return [];
      });
      this.cache.set(key, entry);
    }
    return entry;
  }

  /// Forgets a project's hints after a ticket introduced a new value.
  invalidate(projectKey: string): void {
    const prefix = `${projectKey.toUpperCase()}|`;
    for (const key of [...this.cache.keys()]) if (key.startsWith(prefix)) this.cache.delete(key);
  }
}
