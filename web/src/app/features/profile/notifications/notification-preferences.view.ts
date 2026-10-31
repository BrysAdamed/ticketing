import { ChangeDetectionStrategy, Component, computed, inject, OnInit } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { NotificationKindPreference } from '@core/notifications/notification-preferences.api';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { KIND_COPY } from './notification-preferences.logic';
import { NotificationPreferencesStore } from './notification-preferences.store';

@Component({
  selector: 'tk-notification-preferences-view',
  imports: [
    MatButtonModule,
    MatSlideToggleModule,
    MatTooltipModule,
    EmptyStateComponent,
    IconComponent,
    InlinePickerDirective,
    SkeletonRowsComponent,
  ],
  providers: [NotificationPreferencesStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-profile.notifications' },
  templateUrl: './notification-preferences.view.html',
  styleUrl: './notification-preferences.view.scss',
})
export class NotificationPreferencesView implements OnInit {
  protected readonly store = inject(NotificationPreferencesStore);
  protected readonly copy = KIND_COPY;
  protected readonly sections = computed(() => [
    { id: 'direct', title: 'About you', kinds: this.store.groups().direct },
    { id: 'following', title: 'On things you follow', kinds: this.store.groups().following },
  ]);

  ngOnInit(): void {
    void this.store.load();
  }

  protected toggle(kind: NotificationKindPreference, on: boolean): void {
    void this.store.setKind(kind.kind, !on);
  }
}
