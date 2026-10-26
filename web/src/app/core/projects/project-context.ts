import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ApiError, toApiError } from '../api/api-error';
import { LoadStatus, ProjectDirectory } from './project-directory';
import { ProjectRole, ProjectVisibility } from '@shared/domain/enums';

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
  readonly notFound = computed(() => this.error()?.isNotFound ?? false);

  async load(projectKey: string): Promise<void> {
    const key = projectKey.toUpperCase();
    if (key === this.projectKey() && this.status() === 'loaded') return;
    this.projectKey.set(key);
    this.status.set('loading');
    this.error.set(null);
    if (this.project()?.key !== key) this.project.set(null);
    try {
      this.project.set(await firstValueFrom(this.api.get<ProjectDetail>(`/projects/${key}`)));
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }
}
