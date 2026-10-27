import { CdkTrapFocus } from '@angular/cdk/a11y';
import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  inject,
} from '@angular/core';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { NotificationCenter } from './notification-center';
import { moreLabel } from './notification-format';
import { NotificationFilter, UserNotification } from './notification.models';

/// Content of the notifications popover under the top bar bell.
@Component({
  selector: 'tk-notifications-panel',
  imports: [
    CdkTrapFocus,
    AbsoluteTimePipe,
    RelativeTimePipe,
    AvatarComponent,
    ProjectTileComponent,
    EmptyStateComponent,
    IconComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="tk-popover panel"
      role="dialog"
      aria-labelledby="tk-notifications-title"
      data-testid="notifications-panel"
      tabindex="-1"
      cdkTrapFocus
      (keydown)="onKeydown($event)"
    >
      <div class="head">
        <h2 id="tk-notifications-title">Notifications</h2>
        <tk-segmented
          ariaLabel="Show"
          testId="notifications-filter"
          [options]="filters"
          [value]="center.filter()"
          (valueChange)="center.setFilter($event)"
        />
        <button
          type="button"
          class="mark-all"
          data-testid="notifications-mark-all"
          [disabled]="!center.hasUnread()"
          (click)="center.markAllRead()"
        >
          <tk-icon name="tablerChecks" [size]="14" />Mark all read
        </button>
      </div>
      <div class="body">
        @switch (center.status()) {
          @case ('loading') {
            <tk-skeleton-rows [count]="4" />
          }
          @case ('error') {
            <tk-empty-state
              tone="danger"
              icon="tablerAlertCircle"
              title="Couldn't load notifications"
            >
              <button type="button" class="link" (click)="center.load()">Try again</button>
            </tk-empty-state>
          }
          @default {
            @for (group of center.groups(); track group.label) {
              <div class="day" role="group" [attr.aria-label]="group.label">
                <div class="day-label" aria-hidden="true">{{ group.label }}</div>
                @for (n of group.items; track n.id) {
                  <button
                    type="button"
                    class="row"
                    [class.unread]="!n.readAt"
                    [attr.data-testid]="'notification-row-' + n.id"
                    (click)="center.activate(n)"
                  >
                    <span class="avatar" aria-hidden="true">
                      <tk-avatar
                        [userId]="n.actor?.id"
                        [name]="n.actor?.displayName"
                        [size]="24"
                        [showTitle]="false"
                      />
                    </span>
                    <span class="text">
                      <span class="line">
                        <b>{{ n.actor?.displayName ?? 'Someone' }}</b> {{ n.summary }}
                        @if (more(n); as label) {
                          <span class="more" data-testid="notification-more">{{ label }}</span>
                        }
                      </span>
                      <span class="subject">
                        <tk-project-tile [projectKey]="n.projectKey" />
                        @if (n.ticket; as ticket) {
                          <span class="key">{{ ticket.key }}</span>
                          <span class="title" [class.deleted]="ticket.deleted">{{
                            ticket.title
                          }}</span>
                          @if (ticket.deleted) {
                            <span class="tag">deleted</span>
                          }
                        } @else if (n.regression; as regression) {
                          <span class="key">{{ regression.sessionKey }}</span>
                          <span class="title">{{ regression.sessionName }}</span>
                        }
                      </span>
                    </span>
                    <span class="meta">
                      <time [attr.datetime]="n.updatedAt" [title]="n.updatedAt | absoluteTime">{{
                        n.updatedAt | relativeTime
                      }}</time>
                      @if (!n.readAt) {
                        <span class="dot"></span><span class="tk-sr-only">Unread</span>
                      }
                    </span>
                  </button>
                }
              </div>
            } @empty {
              <tk-empty-state
                icon="tablerChecks"
                title="You're all caught up"
                [description]="
                  center.filter() === 'unread'
                    ? 'No unread notifications.'
                    : 'Changes to tickets you watch or are assigned to show up here.'
                "
              />
            }
            @if (center.nextCursor()) {
              <button
                type="button"
                class="load-more"
                data-testid="notifications-load-more"
                [disabled]="center.loadingMore()"
                (click)="center.loadMore()"
              >
                {{ center.loadingMore() ? 'Loading…' : 'Load more' }}
              </button>
            }
          }
        }
      </div>
    </div>
  `,
  styles: `
    .panel {
      width: 400px;
      max-width: calc(100vw - 32px);
      max-height: 70vh;
      display: flex;
      flex-direction: column;
      outline: 0;
    }
    .head {
      flex: none;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 8px 8px 14px;
      border-bottom: 1px solid var(--tk-border);
    }
    h2 {
      margin: 0 auto 0 0;
      font-size: var(--tk-text-md);
      font-weight: var(--tk-weight-semibold);
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    .mark-all,
    .load-more,
    .link {
      height: 24px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 0 6px;
      border: 0;
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
    }
    .mark-all:hover:not(:disabled),
    .load-more:hover:not(:disabled),
    .link:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    button:disabled {
      color: var(--tk-text-disabled);
      cursor: default;
    }
    .body {
      overflow-y: auto;
      padding-bottom: 4px;
    }
    .day-label {
      padding: 10px 14px 4px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
    }
    .row {
      width: 100%;
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 8px 14px;
      border: 0;
      background: none;
      text-align: left;
      color: var(--tk-text-muted);
      transition: background var(--tk-duration-instant);
    }
    .row:hover,
    .row:focus-visible {
      background: var(--tk-bg-hover);
      outline: 0;
    }
    .row:focus-visible {
      box-shadow: inset 2px 0 0 var(--tk-focus);
    }
    .row.unread {
      color: var(--tk-text);
    }
    .avatar {
      display: inline-flex;
      padding-top: 1px;
    }
    .text {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .line {
      line-height: var(--tk-leading-base);
    }
    .line b {
      font-weight: var(--tk-weight-medium);
    }
    .row.unread .line b {
      font-weight: var(--tk-weight-semibold);
    }
    .more {
      margin-left: 4px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
    }
    .subject {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    .key {
      flex: none;
      color: var(--tk-text-subtle);
      font-variant-numeric: tabular-nums;
    }
    .title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .title.deleted {
      text-decoration: line-through;
      color: var(--tk-text-subtle);
    }
    .tag {
      flex: none;
      color: var(--tk-danger-fg);
      font-size: var(--tk-text-xs);
    }
    .meta {
      flex: none;
      display: flex;
      align-items: center;
      gap: 6px;
      padding-top: 2px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--tk-accent);
    }
    .load-more {
      display: flex;
      margin: 4px auto;
    }
    tk-empty-state {
      margin: 32px auto;
    }
  `,
})
export class NotificationsPanelComponent {
  protected readonly center = inject(NotificationCenter);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    const previous = inject(DOCUMENT).activeElement;
    afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.panel')?.focus());
    inject(DestroyRef).onDestroy(() => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    });
  }

  protected readonly filters: readonly SegmentOption<NotificationFilter>[] = [
    { value: 'all', label: 'All' },
    { value: 'unread', label: 'Unread' },
  ];

  protected more(notification: UserNotification): string | null {
    return moreLabel(notification.eventCount);
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof Element && event.target.closest('tk-segmented')) return;
    const rows = [...this.host.nativeElement.querySelectorAll<HTMLButtonElement>('button.row')];
    if (!rows.length) return;
    event.preventDefault();
    rows[nextRow(event.key, rows.indexOf(event.target as HTMLButtonElement), rows.length)].focus();
  }
}

function nextRow(key: string, current: number, count: number): number {
  const last = count - 1;
  switch (key) {
    case 'Home':
      return 0;
    case 'End':
      return last;
    case 'ArrowDown':
      return current < 0 ? 0 : Math.min(last, current + 1);
    default:
      return current < 0 ? last : Math.max(0, current - 1);
  }
}
