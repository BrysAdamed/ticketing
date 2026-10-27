import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { RegressionItemStatus } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { RegressionSessionStore } from './regression-session.store';
import { SessionRow } from './session-logic';

export const ITEM_ICONS: Record<RegressionItemStatus, { icon: string; color: string }> = {
  WaitingForExecution: { icon: 'tablerCircle', color: 'var(--tk-run-waiting)' },
  Passed: { icon: 'tablerCircleCheck', color: 'var(--tk-run-passed)' },
  Failed: { icon: 'tablerCircleX', color: 'var(--tk-run-failed)' },
  Skipped: { icon: 'tablerCircleMinus', color: 'var(--tk-run-skipped)' },
};

/// The session's items grouped by status. A row focuses its item; its bug key opens the bug in the
/// peek panel; an item whose result is still being saved pulses.
@Component({
  selector: 'tk-session-items',
  imports: [MatTooltip, RouterLink, AvatarComponent, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (row of store.rows(); track trackRow(row)) {
      @if (row.kind === 'group') {
        <div class="ghead">
          <tk-icon
            [name]="icons[row.status].icon"
            [size]="14"
            [style.color]="icons[row.status].color"
          />{{ row.label }}<span class="n tnum">{{ row.count }}</span>
        </div>
      } @else {
        @let it = row.item;
        <div
          class="irow"
          [class.focused]="store.focusedKey() === it.testCaseKey"
          [class.busy]="store.isBusy(it.testCaseKey)"
        >
          <tk-icon
            class="st"
            [name]="it.autoPassed ? 'tablerRobot' : icons[it.status].icon"
            [size]="16"
            [style.color]="icons[it.status].color"
          />
          <button
            type="button"
            class="hit"
            [attr.aria-current]="store.focusedKey() === it.testCaseKey"
            [attr.aria-busy]="store.isBusy(it.testCaseKey) || null"
            [attr.data-testid]="'item-row-' + it.testCaseKey"
            (click)="store.focus(it.testCaseKey)"
          >
            {{ it.title }}
          </button>
          @if (it.bug; as bug) {
            <a
              class="bug tnum"
              [class.deleted]="bug.deleted"
              [routerLink]="[]"
              [queryParams]="{ peek: bug.key }"
              queryParamsHandling="merge"
              [matTooltip]="bug.deleted ? 'Bug deleted' : bug.title"
              [attr.data-testid]="'item-bug-' + it.testCaseKey"
              >{{ bug.key }}</a
            >
          }
          <span class="key tnum">{{ it.testCaseKey }}</span>
          @if (it.assignee; as a) {
            <tk-avatar [userId]="a.id" [name]="a.displayName" />
          } @else {
            <span class="noav"></span>
          }
        </div>
      }
    } @empty {
      <div class="none tk-subtle">No items match.</div>
    }
  `,
  styleUrl: './session-items.component.scss',
})
export class SessionItemsComponent {
  protected readonly store = inject(RegressionSessionStore);
  protected readonly icons = ITEM_ICONS;

  protected trackRow(row: SessionRow): string {
    return row.kind === 'group' ? `g-${row.status}` : row.item.id;
  }
}
