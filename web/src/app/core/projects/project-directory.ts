import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProjectRole, ProjectVisibility } from '@shared/domain/enums';
import { ApiClient } from '../api/api-client';
import { ApiError, toApiError } from '../api/api-error';

/// Item of `GET /api/v1/projects`.
export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  visibility: ProjectVisibility;
  myRole: ProjectRole | null;
  openTicketCount?: number;
  archivedAt?: string | null;
}

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

const SIDEBAR_LIMIT = 100;

/// The readable projects of the signed-in user, shared by the sidebar, the command palette and
/// any feature that needs a project list. Call `reload()` after creating or archiving a project.
@Injectable({ providedIn: 'root' })
export class ProjectDirectory {
  private readonly api = inject(ApiClient);

  private readonly items = signal<readonly ProjectSummary[]>([]);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly projects = this.items.asReadonly();
  readonly activeProjects = computed(() => this.items().filter((p) => !p.archivedAt));

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'loaded') return;
    await this.reload();
  }

  async reload(): Promise<void> {
    this.status.set('loading');
    try {
      const page = await firstValueFrom(
        this.api.list<ProjectSummary>('/projects', { limit: SIDEBAR_LIMIT }),
      );
      this.items.set(page.items);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  byKey(key: string): ProjectSummary | undefined {
    const upper = key.toUpperCase();
    return this.items().find((p) => p.key === upper);
  }

  clear(): void {
    this.items.set([]);
    this.status.set('idle');
    this.error.set(null);
  }
}
