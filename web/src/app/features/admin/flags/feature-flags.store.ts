import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiClient } from '@core/api/api-client';
import { ApiError, toApiError } from '@core/api/api-error';
import { FeatureFlagService } from '@core/flags/feature-flag.service';
import { LoadStatus } from '@core/projects/project-directory';
import { ToastService } from '@core/notify/toast.service';
import { FeatureFlag, FlagInput } from '../admin.models';
import { groupFlags } from './flag-summary';

@Injectable()
export class FeatureFlagsStore {
  private readonly api = inject(ApiClient);
  private readonly toast = inject(ToastService);
  private readonly myFlags = inject(FeatureFlagService);

  readonly flags = signal<readonly FeatureFlag[]>([]);
  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly groups = computed(() => groupFlags(this.flags()));

  async load(): Promise<void> {
    this.status.set('loading');
    try {
      this.flags.set(await firstValueFrom(this.api.get<FeatureFlag[]>('/admin/flags')));
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  async update(flag: FeatureFlag, changes: Partial<FlagInput>): Promise<FeatureFlag> {
    try {
      const updated = await firstValueFrom(
        this.api.patch<FeatureFlag>(`/admin/flags/${encodeURIComponent(flag.key)}`, changes, {
          rowVersion: flag.rowVersion,
        }),
      );
      this.replace(updated);
      void this.myFlags.load();
      return updated;
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.code === 'concurrency.conflict') void this.load();
      throw apiError;
    }
  }

  /// Optimistic master switch with Undo (layout-and-screens 3.11).
  async toggle(flag: FeatureFlag, enabled: boolean): Promise<void> {
    this.replace({ ...flag, enabled });
    try {
      const updated = await this.update(flag, { enabled });
      this.toast.success(`${updated.key} turned ${enabled ? 'on' : 'off'}.`, {
        action: { label: 'Undo', run: () => void this.toggle(updated, !enabled) },
      });
    } catch (error) {
      this.replace(flag);
      this.toast.error(error, {
        action: { label: 'Retry', run: () => void this.toggle(flag, enabled) },
      });
    }
  }

  /// Restores the code default and clears targeting (D-169); rolls back on failure.
  async reset(flag: FeatureFlag): Promise<void> {
    const on = flag.defaultOn === true;
    this.replace({
      ...flag,
      enabled: on,
      rolloutPercentage: on ? 100 : 0,
      targetUsers: [],
      targetRoles: [],
      isDefault: true,
    });
    try {
      const updated = await firstValueFrom(
        this.api.post<FeatureFlag>(`/admin/flags/${encodeURIComponent(flag.key)}/reset`),
      );
      this.replace(updated);
      void this.myFlags.load();
      this.toast.success(`${updated.key} reset to its default (${on ? 'on' : 'off'}).`);
    } catch (error) {
      this.replace(flag);
      this.toast.error(error, {
        action: { label: 'Retry', run: () => void this.reset(flag) },
      });
    }
  }

  async remove(flag: FeatureFlag): Promise<void> {
    await firstValueFrom(this.api.delete(`/admin/flags/${encodeURIComponent(flag.key)}`));
    this.flags.update((list) => list.filter((f) => f.id !== flag.id));
    this.toast.success(`${flag.key} deleted.`);
  }

  private replace(flag: FeatureFlag): void {
    this.flags.update((list) => list.map((f) => (f.id === flag.id ? flag : f)));
  }
}
