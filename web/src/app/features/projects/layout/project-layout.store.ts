import { inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ProjectContext, ProjectDetail } from '@core/projects/project-context';
import { ProjectDirectory } from '@core/projects/project-directory';

/// Actions of the project frame (header and archived banner). Project data lives in ProjectContext.
@Injectable()
export class ProjectLayoutStore {
  private readonly api = inject(ApiClient);
  private readonly context = inject(ProjectContext);
  private readonly directory = inject(ProjectDirectory);

  readonly unarchiving = signal(false);

  async unarchive(): Promise<void> {
    const key = this.context.projectKey();
    this.unarchiving.set(true);
    try {
      this.context.apply(
        await firstValueFrom(this.api.post<ProjectDetail>(`/projects/${key}/unarchive`)),
      );
      void this.directory.reload();
    } finally {
      this.unarchiving.set(false);
    }
  }
}
