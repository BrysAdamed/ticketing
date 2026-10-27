import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { Watchers } from '@core/tickets/ticket.models';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

const PREVIEW = 3;

/// Header action of the ticket view: the Watch / Watching toggle (`W`) and the watcher count with a
/// few avatars, which opens the list of watchers.
@Component({
  selector: 'tk-ticket-watch',
  imports: [CdkConnectedOverlay, CdkOverlayOrigin, MatTooltip, AvatarComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="toggle"
      data-testid="ticket-watch-toggle"
      [class.on]="watchers().watching"
      [attr.aria-pressed]="watchers().watching"
      [matTooltip]="(watchers().watching ? 'Stop watching' : 'Watch for changes') + '  W'"
      (click)="toggled.emit()"
    >
      <tk-icon [name]="watchers().watching ? 'tablerEye' : 'tablerEyeOff'" [size]="14" />{{
        watchers().watching ? 'Watching' : 'Watch'
      }}
    </button>
    <button
      #origin="cdkOverlayOrigin"
      cdkOverlayOrigin
      type="button"
      class="count"
      data-testid="ticket-watchers-count"
      aria-haspopup="dialog"
      [attr.aria-expanded]="open()"
      [attr.aria-label]="countLabel()"
      [matTooltip]="countLabel()"
      (click)="open.set(!open())"
    >
      @for (user of preview(); track user.id) {
        <tk-avatar [userId]="user.id" [name]="user.displayName" [showTitle]="false" />
      }
      <span class="tnum">{{ watchers().count }}</span>
    </button>
    <ng-template
      cdkConnectedOverlay
      cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayHasBackdrop]="true"
      [cdkConnectedOverlayPositions]="positions"
      (backdropClick)="close()"
      (detach)="open.set(false)"
      (overlayKeydown)="onKeydown($event)"
    >
      <div
        class="tk-popover panel"
        role="dialog"
        aria-label="Watchers"
        data-testid="ticket-watchers"
      >
        <div class="head">
          Watchers <span class="n tnum">{{ watchers().count }}</span>
        </div>
        @for (user of watchers().users; track user.id) {
          <div class="row" [attr.data-testid]="'ticket-watcher-row-' + user.email">
            <tk-avatar [userId]="user.id" [name]="user.displayName" [showTitle]="false" />
            <span class="name">{{ user.displayName }}</span>
            @if (user.id === meId()) {
              <span class="you">you</span>
            }
          </div>
        } @empty {
          <div class="empty">Nobody is watching this ticket.</div>
        }
      </div>
    </ng-template>
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      gap: 2px;
      margin-right: 4px;
    }
    button {
      height: 28px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
      cursor: pointer;
      white-space: nowrap;
      transition: background var(--tk-duration-instant);
    }
    button:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    .toggle.on {
      color: var(--tk-accent-fg);
    }
    .count {
      gap: 0;
      padding: 0 6px;
    }
    .count tk-avatar {
      margin-right: -4px;
      box-shadow: 0 0 0 1.5px var(--tk-bg);
    }
    .count .tnum {
      margin-left: 8px;
    }
    .panel {
      width: 240px;
      max-height: 320px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .head {
      padding: 6px 12px 4px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
    }
    .row {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      font-size: var(--tk-text-base);
    }
    .name {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .you {
      margin-left: auto;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
    }
    .empty {
      padding: 8px 12px 10px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class TicketWatchComponent {
  readonly watchers = input.required<Watchers>();
  readonly meId = input<string | null>(null);
  readonly toggled = output<void>();

  protected readonly open = signal(false);
  protected readonly preview = computed(() => this.watchers().users.slice(0, PREVIEW));
  protected readonly countLabel = computed(() => {
    const count = this.watchers().count;
    return count === 1 ? '1 watcher' : `${count} watchers`;
  });
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

  protected close(): void {
    this.open.set(false);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.close();
  }
}
