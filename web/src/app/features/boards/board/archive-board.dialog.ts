import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import { firstValueFrom } from 'rxjs';
import { BoardSummary } from '@core/boards/board.models';
import { BoardsApi } from '@core/boards/boards.api';
import { ToastService } from '@core/notify/toast.service';
import { BoardStore } from './board.store';

type CarryOverMode = 'backlog' | 'board';

/// Archive with carry-over (I-11): unfinished cards go to their backlogs (top) or to another active
/// board (bottom, when it links their project); Done cards stay on the archived board.
@Component({
  selector: 'tk-archive-board-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatRadioModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'archive-board-dialog' },
  template: `
    <h2 mat-dialog-title>Archive {{ store.board()?.name }}</h2>
    <mat-dialog-content>
      <p class="lead">
        {{ openCount() }} unfinished {{ openCount() === 1 ? 'card moves' : 'cards move' }};
        {{ doneCount() }} done {{ doneCount() === 1 ? 'card stays' : 'cards stay' }} on the archived board.
      </p>
      <mat-radio-group class="modes" aria-label="Carry unfinished cards over to" [value]="mode()" (change)="mode.set($event.value)">
        <mat-radio-button value="backlog" data-testid="carry-over-backlog">Their project backlogs (top)</mat-radio-button>
        <mat-radio-button value="board" data-testid="carry-over-board" [disabled]="boards().length === 0">Another board</mat-radio-button>
      </mat-radio-group>
      @if (mode() === 'board') {
        <mat-form-field class="target">
          <mat-select placeholder="Pick a board" data-testid="carry-over-target" [value]="target()" (valueChange)="target.set($event)">
            @for (board of boards(); track board.id) {
              <mat-option [value]="board.id">{{ board.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <p class="hint">Cards whose project the target board doesn't link go to their backlog.</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
      <button mat-flat-button type="button" data-testid="archive-submit" [disabled]="busy() || (mode() === 'board' && !target())" (click)="submit()">
        Archive board
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lead {
      margin: 0 0 12px;
      color: var(--tk-text-muted);
    }
    .modes {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .target {
      width: 100%;
      margin-top: 8px;
    }
    .hint {
      margin: 0;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class ArchiveBoardDialog {
  protected readonly store = inject<BoardStore>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<ArchiveBoardDialog, boolean>>(MatDialogRef);
  private readonly api = inject(BoardsApi);
  private readonly toast = inject(ToastService);

  protected readonly mode = signal<CarryOverMode>('backlog');
  protected readonly target = signal<string | null>(null);
  protected readonly boards = signal<readonly BoardSummary[]>([]);
  protected readonly busy = signal(false);
  protected readonly doneCount = computed(() => this.store.columns().find((c) => c.status === 'Done')?.cards.length ?? 0);
  protected readonly openCount = computed(() => this.store.totalCount() - this.doneCount());

  constructor() {
    void firstValueFrom(this.api.list({}, { limit: 100 }))
      .then((page) => this.boards.set(page.items.filter((b) => b.id !== this.store.boardId())))
      .catch(() => undefined);
  }

  protected async submit(): Promise<void> {
    const target = this.mode() === 'board' ? this.target() : 'backlog';
    if (!target) return;
    this.busy.set(true);
    const result = await this.store.archive(target);
    this.busy.set(false);
    if (!result) return;
    const parts = [
      result.movedToBoard ? `${result.movedToBoard} to ${this.boards().find((b) => b.id === target)?.name ?? 'the other board'}` : null,
      result.movedToBacklog ? `${result.movedToBacklog} to backlogs` : null,
    ].filter(Boolean);
    this.toast.success(parts.length ? `Board archived · moved ${parts.join(', ')}` : 'Board archived');
    this.ref.close(true);
  }
}
