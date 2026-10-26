import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom, Observable } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { LoadStatus } from '@core/projects/project-directory';
import { GlobalRole } from '@shared/domain/enums';
import { AdminToken, AdminUser, CreateUserResult, SetPasswordLink } from '../admin.models';

export type ActiveFilter = 'active' | 'deactivated' | 'all';
export type RoleFilter = 'all' | GlobalRole;

export interface UserFormValue {
  email: string;
  displayName: string;
  globalRole: GlobalRole;
}

const PAGE_SIZE = 100;

/// Admin user list (search, filters, cursor paging) and the user lifecycle actions. Actions throw
/// `ApiError` so the view can explain refused rules (last admin, last project owner).
@Injectable()
export class AdminUsersStore {
  private readonly api = inject(ApiClient);
  private requestId = 0;

  readonly query = signal('');
  readonly activeFilter = signal<ActiveFilter>('active');
  readonly roleFilter = signal<RoleFilter>('all');

  readonly users = signal<readonly AdminUser[]>([]);
  readonly nextCursor = signal<string | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly loadingMore = signal(false);
  readonly error = signal<ApiError | null>(null);
  readonly busyIds = signal<ReadonlySet<string>>(new Set());
  readonly hasFilters = computed(
    () =>
      this.query().trim() !== '' || this.roleFilter() !== 'all' || this.activeFilter() !== 'active',
  );

  async load(): Promise<void> {
    const id = ++this.requestId;
    this.status.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.list<AdminUser>('/admin/users', { limit: PAGE_SIZE }, this.filters()),
      );
      if (id !== this.requestId) return;
      this.users.set(page.items);
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
        this.api.list<AdminUser>('/admin/users', { limit: PAGE_SIZE, cursor }, this.filters()),
      );
      this.users.update((list) => [...list, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } finally {
      this.loadingMore.set(false);
    }
  }

  async create(value: UserFormValue): Promise<CreateUserResult> {
    const result = await firstValueFrom(this.api.post<CreateUserResult>('/admin/users', value));
    this.users.update((list) => [result.user, ...list]);
    return result;
  }

  update(
    user: AdminUser,
    changes: Partial<Pick<UserFormValue, 'displayName' | 'globalRole'>>,
  ): Promise<AdminUser> {
    return this.run(user, () =>
      this.api.patch<AdminUser>(`/admin/users/${user.id}`, changes, {
        rowVersion: user.rowVersion,
      }),
    );
  }

  deactivate(user: AdminUser): Promise<AdminUser> {
    return this.run(user, () => this.api.post<AdminUser>(`/admin/users/${user.id}/deactivate`));
  }

  reactivate(user: AdminUser): Promise<AdminUser> {
    return this.run(user, () => this.api.post<AdminUser>(`/admin/users/${user.id}/reactivate`));
  }

  async issueSetPasswordLink(user: AdminUser): Promise<SetPasswordLink> {
    const link = await firstValueFrom(
      this.api.post<SetPasswordLink>(`/admin/users/${user.id}/set-password-link`),
    );
    this.replace({ ...user, setPasswordLinkExpiresAt: link.expiresAt });
    return link;
  }

  async tokensOf(user: AdminUser): Promise<AdminToken[]> {
    const page = await firstValueFrom(
      this.api.list<AdminToken>('/admin/tokens', { limit: 100 }, { userId: user.id }),
    );
    return page.items;
  }

  async revokeToken(token: AdminToken): Promise<AdminToken> {
    const revoked = await firstValueFrom(
      this.api.post<AdminToken>(`/admin/tokens/${token.id}/revoke`),
    );
    return { ...token, ...revoked, user: token.user };
  }

  /// After revoking from the tokens dialog the active count changes; refetch that one row.
  async refreshUser(userId: string): Promise<void> {
    this.replace(await firstValueFrom(this.api.get<AdminUser>(`/admin/users/${userId}`)));
  }

  isBusy(user: AdminUser): boolean {
    return this.busyIds().has(user.id);
  }

  private async run(user: AdminUser, call: () => Observable<AdminUser>): Promise<AdminUser> {
    this.busyIds.update((ids) => new Set(ids).add(user.id));
    try {
      const updated = await firstValueFrom(call());
      this.replace(updated);
      return updated;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.isConflict && apiError.code === 'concurrency.conflict') void this.load();
      throw apiError;
    } finally {
      this.busyIds.update((ids) => {
        const next = new Set(ids);
        next.delete(user.id);
        return next;
      });
    }
  }

  private replace(user: AdminUser): void {
    this.users.update((list) => list.map((u) => (u.id === user.id ? user : u)));
  }

  private filters() {
    const active = this.activeFilter();
    return {
      query: this.query().trim(),
      isActive: active === 'all' ? undefined : active === 'active',
      role: this.roleFilter() === 'all' ? undefined : this.roleFilter(),
    };
  }
}
