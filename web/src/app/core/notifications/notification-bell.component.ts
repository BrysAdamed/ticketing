import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { CommandRegistry } from '../commands/command-registry';
import { ShortcutService } from '../shortcuts/shortcut.service';
import { NotificationCenter } from './notification-center';
import { badgeText, bellLabel } from './notification-format';
import { NotificationsPanelComponent } from './notifications-panel.component';

export const NOTIFICATIONS_SHORTCUT = 'g n';

/// Top bar bell with the unread count; opens the notifications panel (also `G N`).
@Component({
  selector: 'tk-notification-bell',
  imports: [
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    MatTooltip,
    IconComponent,
    NotificationsPanelComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      #origin="cdkOverlayOrigin"
      cdkOverlayOrigin
      type="button"
      class="tk-icon-btn bell"
      data-testid="notifications-bell"
      aria-haspopup="dialog"
      [class.open]="center.isOpen()"
      [attr.aria-expanded]="center.isOpen()"
      [attr.aria-label]="label()"
      [matTooltip]="tooltip"
      [matTooltipDisabled]="center.isOpen()"
      (click)="center.toggle()"
    >
      <tk-icon name="tablerBell" />
      @if (badge(); as text) {
        <span class="badge" data-testid="notifications-badge" aria-hidden="true">{{ text }}</span>
      }
    </button>
    <ng-template
      cdkConnectedOverlay
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="center.isOpen()"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayPositions]="positions"
      (backdropClick)="center.close()"
      (detach)="center.close()"
      (overlayKeydown)="onKeydown($event)"
    >
      <tk-notifications-panel />
    </ng-template>
  `,
  styles: `
    .bell {
      position: relative;
    }
    .bell.open {
      background: var(--tk-bg-active);
      color: var(--tk-text);
    }
    .badge {
      position: absolute;
      top: 1px;
      left: 14px;
      min-width: 16px;
      height: 16px;
      padding: 0 4px;
      border-radius: var(--tk-radius-full);
      box-shadow: 0 0 0 2px var(--tk-bg);
      background: var(--tk-accent);
      color: var(--tk-text-on-solid);
      font-size: 10px;
      font-weight: var(--tk-weight-semibold);
      font-variant-numeric: tabular-nums;
      line-height: 16px;
      text-align: center;
      pointer-events: none;
    }
  `,
})
export class NotificationBellComponent {
  protected readonly center = inject(NotificationCenter);
  private readonly shortcuts = inject(ShortcutService);

  protected readonly badge = computed(() => badgeText(this.center.unreadCount()));
  protected readonly label = computed(() => bellLabel(this.center.unreadCount()));
  protected readonly tooltip = `Notifications  ${this.shortcuts.format(NOTIFICATIONS_SHORTCUT).join(' ')}`;
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 6 },
  ];

  constructor() {
    const destroyRef = inject(DestroyRef);
    this.shortcuts.registerScoped(
      [
        {
          keys: NOTIFICATIONS_SHORTCUT,
          section: 'Go to',
          description: 'Notifications',
          handler: () => this.center.toggle(),
        },
      ],
      destroyRef,
    );
    inject(CommandRegistry).registerCommands(
      [
        {
          id: 'nav.notifications',
          label: 'Notifications',
          group: 'Navigation',
          icon: 'tablerBell',
          shortcut: NOTIFICATIONS_SHORTCUT,
          run: () => this.center.open(),
        },
      ],
      destroyRef,
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.center.close();
  }
}
