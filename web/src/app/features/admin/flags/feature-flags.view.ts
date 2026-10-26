import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { toApiError } from '@core/api/api-error';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { FeatureFlag } from '../admin.models';
import { FeatureFlagsStore } from './feature-flags.store';
import { FlagFormDialog, FlagFormDialogData } from './flag-form.dialog';
import { targetingSummary } from './flag-summary';

@Component({
  selector: 'tk-feature-flags-view',
  imports: [
    MatButtonModule,
    MatMenuModule,
    MatSlideToggleModule,
    MatTableModule,
    MatTooltip,
    IconComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  providers: [FeatureFlagsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-admin.flags' },
  templateUrl: './feature-flags.view.html',
  styleUrl: './feature-flags.view.scss',
})
export class FeatureFlagsView {
  protected readonly store = inject(FeatureFlagsStore);
  private readonly dialog = inject(MatDialog);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);

  protected readonly columns = ['key', 'enabled', 'targeting', 'usersOn', 'updated', 'actions'];

  constructor() {
    void this.store.load();
    inject(ShortcutService).registerScoped([
      {
        keys: 'n',
        description: 'New feature flag',
        section: 'Feature flags',
        handler: () => this.create(),
      },
    ]);
  }

  protected summary(flag: FeatureFlag): string {
    return targetingSummary(flag);
  }

  protected create(): void {
    this.open({ submit: (key, input) => this.store.create(key, input) }, (flag) =>
      this.toast.success(`${flag.key} created.`),
    );
  }

  protected edit(flag: FeatureFlag): void {
    this.open({ flag, submit: (_key, input) => this.store.update(flag, input) }, (updated) =>
      this.toast.success(`${updated.key} saved.`),
    );
  }

  protected async remove(flag: FeatureFlag): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Delete ${flag.key}?`,
      message:
        'The flag evaluates to off for everyone afterwards. Code that still reads it falls back to its default.',
      confirmLabel: 'Delete flag',
      danger: true,
      requireText: flag.key,
    });
    if (!confirmed) return;
    try {
      await this.store.remove(flag);
    } catch (error) {
      this.toast.error(toApiError(error));
    }
  }

  private open(data: FlagFormDialogData, done: (flag: FeatureFlag) => void): void {
    this.dialog
      .open<FlagFormDialog, FlagFormDialogData, FeatureFlag>(FlagFormDialog, {
        width: '560px',
        data,
      })
      .afterClosed()
      .subscribe((flag) => flag && done(flag));
  }
}
