import { inject, Injectable } from '@angular/core';
import { map, Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page, PageRequest } from '../api/page';
import { UserNotification } from './notification.models';

const BASE = '/me/notifications';

/// The signed-in user's in-app notifications (`/me/notifications`).
@Injectable({ providedIn: 'root' })
export class NotificationsApi {
  private readonly api = inject(ApiClient);

  /// Newest first; `unreadOnly` narrows to rows without `readAt`.
  list(unreadOnly: boolean, page?: PageRequest): Observable<Page<UserNotification>> {
    return this.api.list<UserNotification>(BASE, page, { unread: unreadOnly || undefined });
  }

  unreadCount(): Observable<number> {
    return this.api.get<{ count: number }>(`${BASE}/unread-count`).pipe(map((r) => r.count));
  }

  /// Marks the caller's own rows read and returns the unread count afterwards.
  markRead(ids: readonly string[]): Observable<number> {
    return this.api
      .post<{ unreadCount: number }>(`${BASE}/read`, { ids })
      .pipe(map((r) => r.unreadCount));
  }

  markAllRead(): Observable<number> {
    return this.api
      .post<{ unreadCount: number }>(`${BASE}/read`, { all: true })
      .pipe(map((r) => r.unreadCount));
  }
}
