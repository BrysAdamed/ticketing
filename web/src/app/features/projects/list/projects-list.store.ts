import { computed, inject, Injectable, signal } from '@angular/core';
import { ProjectDirectory } from '@core/projects/project-directory';

export type ProjectFilter = 'all' | 'mine' | 'public' | 'private';

@Injectable()
export class ProjectsListStore {
  private readonly directory = inject(ProjectDirectory);

  readonly filter = signal<ProjectFilter>('all');
  readonly query = signal('');
  readonly status = this.directory.status;
  readonly error = this.directory.error;
  readonly hasData = computed(
    () => this.directory.status() === 'loaded' || this.directory.projects().length > 0,
  );

  readonly projects = computed(() => {
    const q = this.query().trim().toLowerCase();
    return this.directory.activeProjects().filter((p) => {
      if (q && !p.name.toLowerCase().includes(q) && !p.key.toLowerCase().includes(q)) return false;
      switch (this.filter()) {
        case 'mine':
          return p.myRole !== null;
        case 'public':
          return p.visibility === 'Public';
        case 'private':
          return p.visibility === 'Private';
        default:
          return true;
      }
    });
  });

  readonly counts = computed(() => {
    const all = this.directory.activeProjects();
    return {
      all: all.length,
      mine: all.filter((p) => p.myRole !== null).length,
      public: all.filter((p) => p.visibility === 'Public').length,
      private: all.filter((p) => p.visibility === 'Private').length,
    };
  });

  load(): void {
    void this.directory.reload();
  }
}
