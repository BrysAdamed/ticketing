import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { LoadStatus } from '@core/projects/project-directory';
import { AuditedEntityType, AuditEntry, UserLookup } from '../admin.models';

export type EntityFilter = 'all' | AuditedEntityType;

const PAGE_SIZE = 50;

/// The admin audit trail with filters; newest first, cursor paged ("Load older").
@Injectable()
export class AuditLogStore {
  private readonly api = inject(ApiClient);
  private requestId = 0;

  readonly entityType = signal<EntityFilter>('all');
  readonly actor = signal<UserLookup | null>(null);
  readonly action = signal('');
  readonly from = signal('');
  readonly to = signal('');

  readonly entries = signal<readonly AuditEntry[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly loadingMore = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly hasFilters = computed(
    () =>
      this.entityType() !== 'all' ||
      this.actor() !== null ||
      this.action().trim() !== '' ||
      this.from() !== '' ||
      this.to() !== '',
  );

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.status.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.list<AuditEntry>('/admin/audit', { limit: PAGE_SIZE }, this.filters()),
      );
      if (id !== this.requestId) return;
      this.entries.set(page.items);
      this.nextCursor.set(page.nextCursor);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (id !== this.requestId) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  async loadMore(): Promise<void> {
    const cursor = this.nextCursor();
    if (!cursor || this.loadingMore()) return;
    this.loadingMore.set(true);
    try {
      const page = await firstValueFrom(
        this.api.list<AuditEntry>('/admin/audit', { limit: PAGE_SIZE, cursor }, this.filters()),
      );
      this.entries.update((list) => [...list, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } finally {
      this.loadingMore.set(false);
    }
  }

  clearFilters(): void {
    this.entityType.set('all');
    this.actor.set(null);
    this.action.set('');
    this.from.set('');
    this.to.set('');
    void this.load();
  }

  private filters() {
    return {
      entityType: this.entityType() === 'all' ? undefined : this.entityType(),
      actorId: this.actor()?.id,
      action: this.action().trim() || undefined,
      from: startOfLocalDay(this.from()),
      to: endOfLocalDay(this.to()),
    };
  }
}

function startOfLocalDay(date: string): string | undefined {
  return date ? new Date(`${date}T00:00:00`).toISOString() : undefined;
}

function endOfLocalDay(date: string): string | undefined {
  return date ? new Date(`${date}T23:59:59.999`).toISOString() : undefined;
}
