import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ProjectRole, ProjectVisibility } from '@shared/domain/enums';
import { ApiClient } from '../api/api-client';
import { ApiError, toApiError } from '../api/api-error';
import { Page } from '../api/page';

/// Item of `GET /api/v1/projects`.
export interface ProjectSummary {
  id: string;
  key: string;
  name: string;
  /// First 160 characters of the markdown description.
  descriptionPreview?: string | null;
  visibility: ProjectVisibility;
  /// Effective role (spec 5.1): Admins are Owner everywhere, everyone is at least Member on public projects.
  myRole: ProjectRole | null;
  /// The caller has an explicit membership.
  isMember?: boolean;
  openTicketCount?: number;
  ticketCounts?: { toDo: number; inProgress: number; done: number };
  lead?: { userId: string; displayName: string } | null;
  /// Latest ticket update, or the project's creation time.
  updatedAt?: string;
  archivedAt?: string | null;
}

export type LoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

const PAGE_SIZE = 100;
export const MAX_LISTED_PROJECTS = 1000;
const SEARCH_LIMIT = 50;

/// Filters of `GET /api/v1/projects` besides paging.
export interface ProjectQuery {
  query?: string;
  includeArchived?: boolean;
  visibility?: ProjectVisibility;
  mine?: boolean;
}

/// Up to `MAX_LISTED_PROJECTS` projects in key order; `capped` when more match than were loaded.
export interface ProjectList {
  items: ProjectSummary[];
  capped: boolean;
}

/// The readable projects of the signed-in user, shared by the sidebar, the command palette and
/// any feature that needs a project list. Call `reload()` after creating or archiving a project.
/// It holds the first `MAX_LISTED_PROJECTS` by key; when `capped()`, lists use `search()` (D-168).
@Injectable({ providedIn: 'root' })
export class ProjectDirectory {
  private readonly api = inject(ApiClient);

  private readonly items = signal<readonly ProjectSummary[]>([]);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly capped = signal(false);
  readonly projects = this.items.asReadonly();
  readonly activeProjects = computed(() => this.items().filter((p) => !p.archivedAt));

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'loaded') return;
    await this.reload();
  }

  async reload(): Promise<void> {
    this.status.set('loading');
    try {
      const { items, capped } = await this.list();
      this.items.set(items);
      this.capped.set(capped);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  /// Pages `GET /projects` with the given filters up to `MAX_LISTED_PROJECTS`.
  async list(filters: ProjectQuery = {}): Promise<ProjectList> {
    const items: ProjectSummary[] = [];
    let cursor: string | null = null;
    do {
      const page: Page<ProjectSummary> = await firstValueFrom(
        this.api.list<ProjectSummary>('/projects', { limit: PAGE_SIZE, cursor }, { ...filters }),
      );
      items.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor && items.length < MAX_LISTED_PROJECTS);
    return { items, capped: !!cursor };
  }

  /// Active readable projects whose key or name contains `query`, asked from the server: the
  /// path for pickers and the palette once the directory is `capped()`.
  async search(query: string, limit = SEARCH_LIMIT): Promise<ProjectSummary[]> {
    const page = await firstValueFrom(
      this.api.list<ProjectSummary>('/projects', { limit }, { query: query.trim() }),
    );
    return page.items;
  }

  byKey(key: string): ProjectSummary | undefined {
    const upper = key.toUpperCase();
    return this.items().find((p) => p.key === upper);
  }

  clear(): void {
    this.items.set([]);
    this.capped.set(false);
    this.status.set('idle');
    this.error.set(null);
  }
}
