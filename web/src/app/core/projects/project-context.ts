import { computed, DestroyRef, effect, inject, Injectable, signal } from '@angular/core';
import { OpenProjectState } from './open-project';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError, toApiError } from '../api/api-error';
import { SwrCache } from '../api/swr-cache';
import { LoadStatus, ProjectDirectory } from './project-directory';
import { GlobalRole, ProjectRole, ProjectVisibility } from '@shared/domain/enums';

/// Shown after a project is unarchived: archiving unlinked it from every board, and unarchive does not relink (ideas.md).
export const BOARDS_NOT_RELINKED =
  "Its former boards are not linked again; add the project back from each board's settings.";

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
  private readonly cache = inject(SwrCache);

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

  private token = 0;

  constructor() {
    const open = inject(OpenProjectState);
    effect(() => {
      const project = this.project();
      open.project.set(
        project ? { key: project.key, name: project.name, archived: !!project.archivedAt } : null,
      );
    });
    inject(DestroyRef).onDestroy(() => open.project.set(null));
  }

  /// Shows the cached project at once (stale-while-revalidate) and fetches it once per key: calling
  /// it again for the same key while loading, loaded or failed does nothing; `reload()` retries.
  async load(projectKey: string): Promise<void> {
    const key = projectKey.toUpperCase();
    if (key === this.projectKey() && this.status() !== 'idle') return;
    this.projectKey.set(key);
    this.error.set(null);
    await this.fetch(key);
  }

  /// Refetches the current project, keeping the shown data until the response arrives.
  async reload(): Promise<void> {
    if (this.projectKey()) await this.fetch(this.projectKey());
  }

  /// Applies a project returned by a write (PATCH, archive, unarchive), so every tab sees it at once.
  apply(project: ProjectDetail): void {
    if (project.key !== this.projectKey()) return;
    this.project.set(project);
    this.cache.set(projectCacheKey(project.key), project, [projectCacheKey(project.key)]);
  }

  private async fetch(key: string): Promise<void> {
    const token = ++this.token;
    const cacheKey = projectCacheKey(key);
    const { cached, fresh } = this.cache.load(
      cacheKey,
      () => firstValueFrom(this.api.get<ProjectDetail>(`/projects/${key}`)),
      [cacheKey],
    );
    if (cached) this.project.set(cached);
    else if (this.project()?.key !== key) this.project.set(null);
    this.status.set(this.project() ? 'loaded' : 'loading');
    try {
      const project = await fresh;
      if (token !== this.token) return;
      this.project.set(project);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (token !== this.token) return;
      const apiError = toApiError(error);
      this.error.set(apiError);
      if (apiError.isNotFound || !this.project()) {
        this.cache.invalidate(cacheKey);
        this.project.set(null);
        this.status.set('error');
      }
    }
  }
}

function projectCacheKey(key: string): string {
  return `project:${key}`;
}
