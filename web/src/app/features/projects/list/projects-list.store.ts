import { computed, effect, inject, Injectable, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import {
  LoadStatus,
  MAX_LISTED_PROJECTS,
  ProjectDirectory,
  ProjectList,
  ProjectQuery,
  ProjectSummary,
} from '@core/projects/project-directory';

export type ProjectFilter = 'all' | 'mine' | 'public' | 'private';

export interface ProjectCounts {
  all: number;
  mine: number;
  public: number;
  private: number;
}

/// One-line plain text from the markdown description preview: links keep their text, markup is dropped.
export function plainPreview(markdown: string | null | undefined): string {
  return (markdown ?? '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`#>~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

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

export const PROJECT_FILTER_DEBOUNCE_MS = 250;

export function projectQueryFor(
  query: string,
  filter: ProjectFilter,
  includeArchived: boolean,
): ProjectQuery {
  return {
    query: query.trim() || undefined,
    includeArchived: includeArchived || undefined,
    visibility: filter === 'public' ? 'Public' : filter === 'private' ? 'Private' : undefined,
    mine: filter === 'mine' || undefined,
  };
}

interface FilteredList extends ProjectList {
  filterKey: string;
}

/// The project list page: the readable projects (archived ones on request) up to
/// `MAX_LISTED_PROJECTS`, filtered locally so the segment counts and the text filter answer
/// instantly. When more exist (D-168), a filter asks the server instead, so every project can be
/// found. The sidebar's directory is used as the first paint while the list loads.
@Injectable()
export class ProjectsListStore {
  private readonly api = inject(ApiClient);
  private readonly directory = inject(ProjectDirectory);

  readonly filter = signal<ProjectFilter>('all');
  readonly query = signal('');
  readonly showArchived = signal(false);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);

  private readonly loaded = signal<ProjectList | null>(null);
  private readonly filtered = signal<FilteredList | null>(null);
  private readonly items = computed(() => this.loaded()?.items ?? this.directory.activeProjects());
  private loadToken = 0;
  private filterToken = 0;

  private readonly filterKey = computed(() =>
    JSON.stringify(projectQueryFor(this.query(), this.filter(), this.showArchived())),
  );

  readonly hasData = computed(() => this.loaded() !== null || this.directory.status() === 'loaded');
  readonly isFiltered = computed(() => !!this.query().trim() || this.filter() !== 'all');
  /// More projects exist than the unfiltered list holds; counts are then lower bounds.
  readonly capped = computed(() => this.loaded()?.capped ?? this.directory.capped());
  private readonly serverFiltered = computed(() => this.capped() && this.isFiltered());
  private readonly currentFiltered = computed(() => {
    const filtered = this.filtered();
    return filtered && filtered.filterKey === this.filterKey() ? filtered : null;
  });
  readonly searching = computed(() => this.serverFiltered() && this.currentFiltered() === null);
  readonly projects = computed(() => {
    const source = this.serverFiltered()
      ? (this.currentFiltered()?.items ?? this.items())
      : this.items();
    return filterProjects(source, this.query(), this.filter());
  });
  /// The rows shown are cut: the unfiltered list, or the server's matches for the filter.
  readonly truncated = computed(() =>
    this.serverFiltered() ? (this.currentFiltered()?.capped ?? false) : this.capped(),
  );
  readonly counts = computed(() => countProjects(this.items()));
  readonly listedLimit = MAX_LISTED_PROJECTS;

  constructor() {
    effect((onCleanup) => {
      this.loaded();
      if (!this.serverFiltered()) return;
      const filters = untracked(() =>
        projectQueryFor(this.query(), this.filter(), this.showArchived()),
      );
      const filterKey = this.filterKey();
      const token = ++this.filterToken;
      const timer = setTimeout(() => {
        this.directory.list(filters).then(
          (list) => {
            if (token === this.filterToken) this.filtered.set({ ...list, filterKey });
          },
          (error) => {
            if (token !== this.filterToken) return;
            this.filtered.set({ items: [], capped: false, filterKey });
            this.error.set(toApiError(error));
          },
        );
      }, PROJECT_FILTER_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    });
  }

  async load(): Promise<void> {
    const token = ++this.loadToken;
    this.status.set('loading');
    this.filtered.set(null);
    try {
      const list = await this.directory.list({ includeArchived: this.showArchived() || undefined });
      if (token !== this.loadToken) return;
      this.loaded.set(list);
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
}
