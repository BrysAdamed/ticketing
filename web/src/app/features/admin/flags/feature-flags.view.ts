import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTableModule } from '@angular/material/table';
import { MatTooltip } from '@angular/material/tooltip';
import { provideIcons } from '@ng-icons/core';
import { tablerRestore, tablerTrash } from '@ng-icons/tabler-icons';
import { toApiError } from '@core/api/api-error';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
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
    BadgeComponent,
    IconComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  providers: [FeatureFlagsStore],
  viewProviders: [provideIcons({ tablerRestore, tablerTrash })],
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
  protected readonly retiredColumns = ['key', 'targeting', 'updated', 'actions'];

  constructor() {
    void this.store.load();
  }

  protected summary(flag: FeatureFlag): string {
    return targetingSummary(flag);
  }

  protected edit(flag: FeatureFlag): void {
    this.dialog
      .open<FlagFormDialog, FlagFormDialogData, FeatureFlag>(FlagFormDialog, {
        width: '560px',
        data: { flag, submit: (input) => this.store.update(flag, input) },
      })
      .afterClosed()
      .subscribe((updated) => updated && this.toast.success(`${updated.key} saved.`));
  }

  protected async reset(flag: FeatureFlag): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Reset ${flag.key} to its default?`,
      message: `It turns ${flag.defaultOn ? 'on for everyone' : 'off for everyone'}, as declared in code, and its users, roles and percentage are cleared.`,
      confirmLabel: 'Reset to default',
    });
    if (confirmed) await this.store.reset(flag);
  }

  protected async remove(flag: FeatureFlag): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Delete ${flag.key}?`,
      message:
        'The code no longer reads this flag. Deleting it removes its targeting; the audit log keeps the last configuration.',
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
}
