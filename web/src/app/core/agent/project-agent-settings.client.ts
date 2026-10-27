import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { ProjectAgentSettings } from '../projects/project-context';

/// Fields of `PATCH /projects/{pk}/agent`; omitted fields stay unchanged, a null or blank repository URL clears it.
export type ProjectAgentSettingsPatch = Partial<
  Pick<
    ProjectAgentSettings,
    | 'enabled'
    | 'repositoryUrl'
    | 'defaultBranch'
    | 'mergePolicy'
    | 'assignOnDelegate'
    | 'startProgressOnDelegate'
  >
>;

/// A project's agent setup (`/projects/{pk}/agent`). Writes need an Owner's web session.
@Injectable({ providedIn: 'root' })
export class ProjectAgentSettingsClient {
  private readonly api = inject(ApiClient);

  get(projectKey: string): Observable<ProjectAgentSettings> {
    return this.api.get(`/projects/${projectKey}/agent`);
  }

  update(
    projectKey: string,
    patch: ProjectAgentSettingsPatch,
    rowVersion: number,
  ): Observable<ProjectAgentSettings> {
    return this.api.patch(`/projects/${projectKey}/agent`, patch, { rowVersion });
  }
}
