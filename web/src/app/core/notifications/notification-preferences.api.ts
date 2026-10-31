import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { NotificationKind } from './notification.models';

export interface NotificationKindPreference {
  kind: NotificationKind;
  muted: boolean;
  /// Addressed to the user personally (mentions, assignments): a muted project does not silence it.
  direct: boolean;
}

export interface MutedProject {
  id: string;
  key: string;
  name: string;
}

/// `GET /me/notification-preferences` (D-160). Muted projects the user can no longer read are left out.
export interface NotificationPreferences {
  kinds: NotificationKindPreference[];
  mutedProjects: MutedProject[];
  updatedAt: string | null;
}

/// `PATCH /me/notification-preferences`: set changes, so concurrent calls never undo each other.
export interface NotificationPreferencesChange {
  muteKinds?: NotificationKind[];
  unmuteKinds?: NotificationKind[];
  muteProjects?: string[];
  unmuteProjects?: string[];
}

const BASE = '/me/notification-preferences';

@Injectable({ providedIn: 'root' })
export class NotificationPreferencesApi {
  private readonly api = inject(ApiClient);

  get(): Observable<NotificationPreferences> {
    return this.api.get<NotificationPreferences>(BASE);
  }

  change(change: NotificationPreferencesChange): Observable<NotificationPreferences> {
    return this.api.patch<NotificationPreferences>(BASE, change);
  }
}
