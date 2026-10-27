import { inject, Injectable } from '@angular/core';
import { firstValueFrom, fromEvent, takeUntil } from 'rxjs';
import { MentionSearch } from '@shared/markdown/mentions';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { SearchFn } from '@shared/ui/search-picker/search-picker.directive';
import { ApiClient } from '../api/api-client';
import { UserRef } from './ticket.models';

const UNASSIGNED: PickerOption<UserRef | null> = {
  value: null,
  label: 'Unassigned',
  keywords: ['none'],
};

/// People who can be assigned in a project (I-01), searched on the server so public projects offer
/// every active user, not only members.
@Injectable({ providedIn: 'root' })
export class ProjectPeople {
  private readonly api = inject(ApiClient);

  /// Server-side search over every user who can be assigned in the project (`GET /users?projectKey=`):
  /// any active user on a public project, Admins and Owner/Member members on a private one. At most 20.
  search(projectKey: string, query: string): Promise<UserRef[]> {
    return firstValueFrom(
      this.api.get<UserRef[]>('/users', {
        projectKey: projectKey.toUpperCase(),
        query: query.trim(),
      }),
    );
  }

  /// The `@` picker source of the markdown editor (D-96): active users who can read the project, viewers
  /// included (`GET /users?projectKey=&query=&access=read`). Aborting resolves with no users.
  mentionSearch(projectKey: () => string): MentionSearch {
    return (query, signal) =>
      firstValueFrom(
        this.api
          .get<UserRef[]>('/users', {
            projectKey: projectKey().toUpperCase(),
            query: query.trim(),
            access: 'read',
          })
          .pipe(takeUntil(fromEvent(signal, 'abort'))),
        { defaultValue: [] as UserRef[] },
      );
  }

  /// A type-ahead `tkSearchPicker` source over `search`. With `unassigned`, "Unassigned" (value null)
  /// leads the list while the query is empty or matches it.
  picker(projectKey: () => string, unassigned = true): SearchFn<UserRef | null> {
    return async (query) => {
      const users = await this.search(projectKey(), query);
      const options = users.map<PickerOption<UserRef | null>>((user) => ({
        value: user,
        label: user.displayName,
        keywords: [user.email],
      }));
      const q = query.trim().toLowerCase();
      return unassigned && 'unassigned'.startsWith(q) ? [UNASSIGNED, ...options] : options;
    };
  }
}
