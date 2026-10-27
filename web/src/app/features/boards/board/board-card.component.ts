import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { BoardCard, BoardParent } from '@core/boards/board.models';
import { UserRef } from '@core/tickets/ticket.models';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { SeverityBadgeComponent } from '@shared/ui/domain/domain-badges';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';

/// A compact board card (board.html): type, key, parent and avatar; a two-line title; priority, severity
/// (Blocker, Critical, Major), up to two labels, sub-ticket progress for parents and points.
@Component({
  selector: 'tk-board-card',
  imports: [
    MatTooltip,
    AvatarComponent,
    SeverityBadgeComponent,
    LabelChipComponent,
    PriorityIconComponent,
    TypeIconComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'card',
    role: 'button',
    tabindex: '-1',
    '[class.done]': 'done()',
    '[class.sel]': 'selected()',
    '[class.focus]': 'focused()',
    '[class.locked]': 'locked()',
    '[attr.aria-pressed]': 'selected()',
    '[attr.aria-label]': 'card().key + " " + card().title',
    '[attr.data-testid]': '"board-card-" + card().key',
  },
  template: `
    <div class="c1">
      <tk-type-icon [type]="card().type" [size]="14" />
      <span class="key tnum">{{ card().key }}</span>
      @if (parent(); as p) {
        <span class="parent" [matTooltip]="p.key + ' ' + p.title">
          <tk-type-icon [type]="p.type" [size]="12" />
          <span class="ptitle">{{ p.title }}</span>
        </span>
      }
      <span class="av">
        @if (assignee(); as user) {
          <tk-avatar [userId]="user.id" [name]="user.displayName" />
        } @else {
          <span class="none" title="Unassigned"><tk-icon name="tablerUser" [size]="12" /></span>
        }
      </span>
    </div>
    <div class="ct">{{ card().title }}</div>
    <div class="c3">
      <tk-priority-icon [priority]="card().priority" />
      @if (
        card().severity === 'Blocker' ||
        card().severity === 'Critical' ||
        card().severity === 'Major'
      ) {
        <tk-severity-badge [severity]="card().severity!" />
      }
      <span class="labels">
        @for (label of card().labels.slice(0, 2); track label) {
          <tk-label-chip [label]="label" />
        }
        @if (card().labels.length > 2) {
          <span class="more">+{{ card().labels.length - 2 }}</span>
        }
      </span>
      <span class="end">
        @if (card().childCount > 0) {
          <span
            class="sub tnum"
            data-testid="card-progress"
            matTooltip="Sub-tickets done"
            [attr.aria-label]="card().childDoneCount + ' of ' + card().childCount + ' sub-tickets done'"
            ><tk-icon name="tablerSubtask" [size]="12" />{{ card().childDoneCount }}/{{
              card().childCount
            }}</span
          >
        }
        @if (card().storyPoints !== null) {
          <span class="pts tnum" [attr.aria-label]="card().storyPoints + ' story points'">{{
            card().storyPoints
          }}</span>
        }
      </span>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 9px 10px 8px;
      background: var(--tk-surface);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      box-shadow: var(--tk-shadow-xs);
      cursor: grab;
      position: relative;
      outline: none;
      transition: border-color var(--tk-duration-instant);
      contain: layout paint;
    }
    :host(:hover) {
      border-color: var(--tk-border-strong);
    }
    :host(.focus) {
      outline: 2px solid var(--tk-focus);
      outline-offset: -1px;
    }
    :host(.sel) {
      background: color-mix(in srgb, var(--tk-accent) 6%, var(--tk-surface));
      border-color: var(--tk-accent-border);
    }
    :host(.locked) {
      cursor: pointer;
    }
    :host(.done) {
      box-shadow: none;
    }
    :host(.done) .ct {
      color: var(--tk-text-muted);
    }
    .c1,
    .c3 {
      display: flex;
      align-items: center;
      gap: 6px;
      height: 20px;
      min-width: 0;
    }
    .key {
      flex: none;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .av {
      margin-left: auto;
      display: flex;
      flex: none;
    }
    .none {
      width: 20px;
      height: 20px;
      display: grid;
      place-items: center;
      border: 1px dashed var(--tk-border-strong);
      border-radius: var(--tk-radius-full);
      color: var(--tk-text-subtle);
    }
    .ct {
      font-weight: var(--tk-weight-medium);
      line-height: 19px;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      overflow-wrap: anywhere;
    }
    .more {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
    }
    .end {
      margin-left: auto;
      display: flex;
      align-items: center;
      gap: 8px;
      flex: none;
    }
    .labels {
      display: flex;
      align-items: center;
      gap: 4px;
      min-width: 0;
      overflow: hidden;
    }
    .parent {
      flex: 1;
      display: inline-flex;
      align-items: center;
      gap: 3px;
      min-width: 0;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
    }
    .ptitle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .sub {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
    }
    .pts {
      min-width: 20px;
      height: 18px;
      padding: 0 5px;
      display: inline-grid;
      place-items: center;
      flex: none;
      border-radius: var(--tk-radius-full);
      background: var(--tk-bg-muted);
      border: 1px solid var(--tk-border-subtle);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      color: var(--tk-text-muted);
    }
  `,
})
export class BoardCardComponent {
  readonly card = input.required<BoardCard>();
  readonly assignee = input<UserRef | null>(null);
  readonly parent = input<BoardParent | null>(null);
  readonly done = input(false);
  readonly selected = input(false);
  readonly focused = input(false);
  readonly locked = input(false);
}
