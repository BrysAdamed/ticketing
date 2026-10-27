import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { AbsoluteTimePipe, RelativeTimePipe } from '../pipes/relative-time.pipe';
import { UserDisplayComponent, UserRef } from '../ui/domain/user-display.component';

/// A version row of a prompt's history (structurally the `…/versions` items).
export interface PromptHistoryEntry {
  number: number;
  mode: 'Inherit' | 'Custom' | 'Off';
  builtInVersion: string | null;
  changeNote: string | null;
  author: UserRef | null;
  createdAt: string;
  restoredFrom: number | null;
}

/// Version list of a prompt, newest first: number, what it was, note, author and time, with View,
/// Compare (against the current text) and Restore (not offered for the current version or when
/// `canRestore` is false).
@Component({
  selector: 'tk-prompt-history',
  imports: [MatButtonModule, UserDisplayComponent, RelativeTimePipe, AbsoluteTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'prompt-history' },
  template: `
    <ol class="list">
      @for (entry of versions(); track entry.number) {
        <li
          class="entry"
          [class.selected]="entry.number === selected()"
          [attr.data-testid]="'prompt-history-row-' + entry.number"
        >
          <div class="line">
            <span class="number tnum">v{{ entry.number }}</span>
            <span class="what">{{ describe(entry) }}</span>
            @if (entry.number === currentVersion()) {
              <span class="current">Current</span>
            }
            <span class="spacer"></span>
            <span class="time tk-subtle" [title]="entry.createdAt | absoluteTime">{{
              entry.createdAt | relativeTime
            }}</span>
          </div>
          @if (entry.changeNote) {
            <p class="note">{{ entry.changeNote }}</p>
          }
          <div class="line">
            <tk-user [user]="entry.author" emptyLabel="System" />
            <span class="spacer"></span>
            <button
              mat-button
              type="button"
              [attr.data-testid]="'prompt-history-view-' + entry.number"
              (click)="view.emit(entry.number)"
            >
              View
            </button>
            @if (entry.number !== currentVersion()) {
              <button
                mat-button
                type="button"
                [attr.data-testid]="'prompt-history-compare-' + entry.number"
                (click)="compare.emit(entry.number)"
              >
                Compare
              </button>
              @if (canRestore()) {
                <button
                  mat-button
                  type="button"
                  [attr.data-testid]="'prompt-history-restore-' + entry.number"
                  (click)="restore.emit(entry.number)"
                >
                  Restore
                </button>
              }
            }
          </div>
        </li>
      } @empty {
        <li class="empty tk-subtle">No versions yet. The first save creates version 1.</li>
      }
    </ol>
  `,
  styles: `
    .list {
      margin: 0;
      padding: 0;
      list-style: none;
    }
    .entry {
      padding: 8px 4px;
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    .entry.selected {
      background: var(--tk-accent-subtle);
    }
    .line {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 28px;
    }
    .number {
      font-weight: var(--tk-weight-semibold);
    }
    .what {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .current {
      font-size: var(--tk-text-xs);
      color: var(--tk-accent-fg);
      font-weight: var(--tk-weight-medium);
    }
    .spacer {
      flex: 1;
    }
    .time {
      font-size: var(--tk-text-sm);
    }
    .note {
      margin: 2px 0 4px;
      font-size: var(--tk-text-sm);
      color: var(--tk-text);
    }
    .empty {
      padding: 8px 4px;
      font-size: var(--tk-text-sm);
    }
  `,
})
export class PromptHistoryComponent {
  readonly versions = input.required<readonly PromptHistoryEntry[]>();
  readonly currentVersion = input<number | null>(null);
  readonly selected = input<number | null>(null);
  readonly canRestore = input(false);

  readonly view = output<number>();
  readonly compare = output<number>();
  readonly restore = output<number>();

  protected describe(entry: PromptHistoryEntry): string {
    const what =
      entry.mode === 'Inherit' ? 'Use default' : entry.mode === 'Off' ? 'Off' : 'Custom text';
    if (entry.restoredFrom !== null) return `${what}, restored from v${entry.restoredFrom}`;
    if (entry.builtInVersion) return `Built-in ${entry.builtInVersion}`;
    return what;
  }
}
