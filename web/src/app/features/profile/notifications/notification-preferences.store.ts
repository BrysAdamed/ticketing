import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import {
  MutedProject,
  NotificationPreferences,
  NotificationPreferencesApi,
} from '@core/notifications/notification-preferences.api';
import { NotificationKind } from '@core/notifications/notification.models';
import { ToastService } from '@core/notify/toast.service';
import { LoadStatus, ProjectDirectory } from '@core/projects/project-directory';
import { CAPPED_PROJECTS_HINT, findProjects } from '@core/projects/project-search';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import {
  applyEdit,
  groupKinds,
  invertEdit,
  PreferenceEdit,
  projectsToMute,
  toChange,
} from './notification-preferences.logic';

@Injectable()
export class NotificationPreferencesStore {
  private readonly api = inject(NotificationPreferencesApi);
  private readonly toast = inject(ToastService);
  private readonly directory = inject(ProjectDirectory);
  private pending = 0;

  readonly preferences = signal<NotificationPreferences | null>(null);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly groups = computed(() => groupKinds(this.preferences()?.kinds ?? []));
  readonly mutedProjects = computed(() => this.preferences()?.mutedProjects ?? []);
  /// Every project the directory lists is muted and there are no others to find.
  readonly allProjectsMuted = computed(
    () =>
      !this.directory.capped() &&
      projectsToMute(this.directory.projects(), this.mutedProjects()).length === 0,
  );
  readonly projectsHint = computed(() => (this.directory.capped() ? CAPPED_PROJECTS_HINT : null));
  readonly searchProjects = async (query: string): Promise<PickerOption<MutedProject>[]> =>
    projectsToMute(await findProjects(this.directory, query), this.mutedProjects());

  async load(): Promise<void> {
    this.status.set('loading');
    void this.directory.load();
    try {
      this.preferences.set(await firstValueFrom(this.api.get()));
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  setKind(kind: NotificationKind, muted: boolean): Promise<boolean> {
    return this.apply({ type: 'kind', kind, muted });
  }

  async muteProject(project: MutedProject): Promise<void> {
    if (await this.apply({ type: 'project', project, muted: true })) {
      this.toast.success(`Activity in ${project.key} is muted.`, {
        action: { label: 'Undo', run: () => void this.unmuteProject(project) },
      });
    }
  }

  unmuteProject(project: MutedProject): Promise<boolean> {
    return this.apply({ type: 'project', project, muted: false });
  }

  /// Optimistic: shows the edit at once, rolls back only this edit on failure, and takes the
  /// server's state once no other edit is still on its way.
  private async apply(edit: PreferenceEdit): Promise<boolean> {
    const current = this.preferences();
    if (!current) return false;
    this.preferences.set(applyEdit(current, edit));
    this.pending++;
    try {
      const saved = await firstValueFrom(this.api.change(toChange(edit)));
      if (--this.pending === 0) this.preferences.set(saved);
      return true;
    } catch (error) {
      this.pending--;
      this.preferences.update((p) => (p ? applyEdit(p, invertEdit(edit)) : p));
      this.toast.error(error, { action: { label: 'Retry', run: () => void this.apply(edit) } });
      return false;
    }
  }
}
