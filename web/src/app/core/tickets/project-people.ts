import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProjectRole } from '@shared/domain/enums';
import { ApiClient } from '../api/api-client';
import { UserRef } from './ticket.models';

interface ProjectMembers {
  members: {
    userId: string;
    email: string;
    displayName: string;
    role: ProjectRole;
    isActive: boolean;
  }[];
}

/// Users who can be assigned in a project (active Owners and Members, I-01), cached per project for
/// the assignee pickers. Public projects also accept any active user; pickers add the current user.
@Injectable({ providedIn: 'root' })
export class ProjectPeople {
  private readonly api = inject(ApiClient);
  private readonly cache = new Map<string, Promise<UserRef[]>>();

  assignable(projectKey: string): Promise<UserRef[]> {
    const key = projectKey.toUpperCase();
    let entry = this.cache.get(key);
    if (!entry) {
      entry = firstValueFrom(this.api.get<ProjectMembers>(`/projects/${key}`))
        .then((project) =>
          project.members
            .filter((m) => m.isActive && m.role !== 'Viewer')
            .map((m) => ({
              id: m.userId,
              email: m.email,
              displayName: m.displayName,
              isActive: m.isActive,
            }))
            .sort((a, b) => a.displayName.localeCompare(b.displayName)),
        )
        .catch((error: unknown) => {
          this.cache.delete(key);
          throw error;
        });
      this.cache.set(key, entry);
    }
    return entry;
  }

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
}
