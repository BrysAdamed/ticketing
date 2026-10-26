import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { LoadStatus, ProjectDirectory, ProjectSummary } from '@core/projects/project-directory';

export type ProjectFilter = 'all' | 'mine' | 'public' | 'private';

export interface ProjectCounts {
  all: number;
  mine: number;
  public: number;
  private: number;
}

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

export function matchesProjectFilter(project: ProjectSummary, filter: ProjectFilter): boolean {
  switch (filter) {
    case 'mine':
      return project.isMember === true;
    case 'public':
      return project.visibility === 'Public';
    case 'private':
      return project.visibility === 'Private';
    default:
      return true;
  }
}

export function filterProjects(
  projects: readonly ProjectSummary[],
  query: string,
  filter: ProjectFilter,
): ProjectSummary[] {
  const q = query.trim().toLowerCase();
  return projects.filter(
    (p) =>
      (!q || p.name.toLowerCase().includes(q) || p.key.toLowerCase().includes(q)) &&
      matchesProjectFilter(p, filter),
  );
}

export function countProjects(projects: readonly ProjectSummary[]): ProjectCounts {
  return {
    all: projects.length,
    mine: projects.filter((p) => matchesProjectFilter(p, 'mine')).length,
    public: projects.filter((p) => matchesProjectFilter(p, 'public')).length,
    private: projects.filter((p) => matchesProjectFilter(p, 'private')).length,
  };
}

/// The project list page: every readable project (archived ones on request), filtered locally so
/// the segment counts and the text filter answer instantly. The sidebar's directory is used as
/// the first paint while the full list loads.
@Injectable()
export class ProjectsListStore {
  private readonly api = inject(ApiClient);
  private readonly directory = inject(ProjectDirectory);

  readonly filter = signal<ProjectFilter>('all');
  readonly query = signal('');
  readonly showArchived = signal(false);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  private readonly loaded = signal<readonly ProjectSummary[] | null>(null);
  private readonly items = computed(() => this.loaded() ?? this.directory.activeProjects());
  private loadToken = 0;

  readonly hasData = computed(() => this.loaded() !== null || this.directory.status() === 'loaded');
  readonly projects = computed(() => filterProjects(this.items(), this.query(), this.filter()));
  readonly counts = computed(() => countProjects(this.items()));
  readonly isFiltered = computed(() => !!this.query().trim() || this.filter() !== 'all');

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.status.set('loading');
    try {
      const items = await this.fetchAll(this.showArchived());
      if (token !== this.loadToken) return;
      this.loaded.set(items);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      if (token !== this.loadToken) return;
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  setShowArchived(show: boolean): void {
    if (show === this.showArchived()) return;
    this.showArchived.set(show);
    void this.load();
  }

  /// Applies a project created, archived or unarchived elsewhere (dialog, row menu) and refreshes
  /// the sidebar.
  async changed(): Promise<void> {
    await Promise.all([this.load(), this.directory.reload()]);
  }

  async archive(project: ProjectSummary): Promise<void> {
    await firstValueFrom(this.api.post(`/projects/${project.key}/archive`));
    await this.changed();
  }

  async unarchive(project: ProjectSummary): Promise<void> {
    await firstValueFrom(this.api.post(`/projects/${project.key}/unarchive`));
    await this.changed();
  }

  private async fetchAll(includeArchived: boolean): Promise<ProjectSummary[]> {
    const items: ProjectSummary[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await firstValueFrom(
        this.api.list<ProjectSummary>(
          '/projects',
          { limit: PAGE_SIZE, cursor },
          { includeArchived },
        ),
      );
      items.push(...result.items);
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }
    return items;
  }
}
