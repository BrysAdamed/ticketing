import {
  EnvironmentProviders,
  inject,
  Injectable,
  InjectionToken,
  makeEnvironmentProviders,
  Type,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ProjectVisibility } from '@shared/domain/enums';
import { ProjectDetail } from './project-context';
import { ProjectDirectory } from './project-directory';

/// Values the New project dialog opens with; every field stays editable.
export interface CreateProjectPrefill {
  name?: string;
  key?: string;
  visibility?: ProjectVisibility;
}

export const CREATE_PROJECT_DIALOG = new InjectionToken<() => Promise<Type<unknown>>>(
  'CREATE_PROJECT_DIALOG',
);

/// Opens the New project dialog (lazy) from outside the projects feature, for example the "Your
/// first project" walkthrough with its suggestions. Resolves with the created project after the
/// project directory has reloaded, or null when the user cancels.
@Injectable({ providedIn: 'root' })
export class ProjectCreator {
  private readonly dialog = inject(MatDialog);
  private readonly directory = inject(ProjectDirectory);
  private readonly loadDialog = inject(CREATE_PROJECT_DIALOG, { optional: true });

  async open(prefill: CreateProjectPrefill = {}): Promise<ProjectDetail | null> {
    if (!this.loadDialog) throw new Error('provideProjectCreation() is missing.');
    const component = await this.loadDialog();
    const ref = this.dialog.open<unknown, CreateProjectPrefill, ProjectDetail>(component, {
      data: prefill,
      width: '520px',
      autoFocus: 'first-tabbable',
    });
    const project = (await firstValueFrom(ref.afterClosed())) ?? null;
    if (project) await this.directory.reload();
    return project;
  }
}

export function provideProjectCreation(
  loadDialog: () => Promise<Type<unknown>>,
): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: CREATE_PROJECT_DIALOG, useValue: loadDialog }]);
}
