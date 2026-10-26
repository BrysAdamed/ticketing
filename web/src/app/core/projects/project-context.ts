import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError, toApiError } from '../api/api-error';
import { LoadStatus, ProjectDirectory } from './project-directory';
import { GlobalRole, ProjectRole, ProjectVisibility } from '@shared/domain/enums';

/// Member row of a project (`members` in `GET /api/v1/projects/{key}`, or `GET …/members`).
export interface ProjectMember {
  userId: string;
  email: string;
  displayName: string;
  /// Stored membership role.
  role: ProjectRole;
  /// What the membership grants (spec 5.1); null for deactivated users.
  effectiveRole: ProjectRole | null;
  isActive: boolean;
  globalRole: GlobalRole;
  addedAt: string;
}

/// `GET /api/v1/projects/{key}`.
export interface ProjectDetail {
  id: string;
  key: string;
  name: string;
  description: string | null;
  visibility: ProjectVisibility;
  myRole: ProjectRole | null;
  archivedAt: string | null;
  createdAt: string;
  members: ProjectMember[];
  boards: { id: string; name: string }[];
  rowVersion: number;
}

/// Project in context, shared by every project tab. Provided by the project layout view, so tab
/// pages can `inject(ProjectContext)` to read the current project.
@Injectable()
export class ProjectContext {
  private readonly api = inject(ApiClient);
  private readonly directory = inject(ProjectDirectory);

  readonly projectKey = signal<string>('');
  readonly project = signal<ProjectDetail | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  readonly name = computed(
    () =>
      this.project()?.name ?? this.directory.byKey(this.projectKey())?.name ?? this.projectKey(),
  );
  readonly visibility = computed(
    () => this.project()?.visibility ?? this.directory.byKey(this.projectKey())?.visibility ?? null,
  );
  readonly isOwner = computed(() => this.project()?.myRole === 'Owner');
  readonly isArchived = computed(() => !!this.project()?.archivedAt);
  /// Owner or Member on a project that is not archived (spec 5.3).
  readonly canWrite = computed(() => {
    const role = this.project()?.myRole;
    return (role === 'Owner' || role === 'Member') && !this.isArchived();
  });
  readonly notFound = computed(() => this.error()?.isNotFound ?? false);

  async load(projectKey: string): Promise<void> {
    const key = projectKey.toUpperCase();
    if (key === this.projectKey() && this.status() === 'loaded') return;
    this.projectKey.set(key);
    this.status.set('loading');
    this.error.set(null);
    if (this.project()?.key !== key) this.project.set(null);
    await this.fetch(key);
  }

  /// Refetches the current project, keeping the shown data until the response arrives.
  async reload(): Promise<void> {
    if (this.projectKey()) await this.fetch(this.projectKey());
  }

  /// Applies a project returned by a write (PATCH, archive, unarchive), so every tab sees it at once.
  apply(project: ProjectDetail): void {
    if (project.key === this.projectKey()) this.project.set(project);
  }

  private async fetch(key: string): Promise<void> {
    try {
      this.project.set(await firstValueFrom(this.api.get<ProjectDetail>(`/projects/${key}`)));
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }
}
