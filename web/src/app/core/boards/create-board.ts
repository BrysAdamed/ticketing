import {
  EnvironmentProviders,
  inject,
  Injectable,
  InjectionToken,
  makeEnvironmentProviders,
  Type,
} from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { BoardDirectory } from './board-directory';
import { Board, NewBoard } from './board.models';
import { BoardsApi } from './boards.api';

/// Values the New board dialog opens with; every field stays editable.
export interface CreateBoardPrefill {
  name?: string;
  projectKeys?: readonly string[];
}

export const CREATE_BOARD_DIALOG = new InjectionToken<() => Promise<Type<unknown>>>(
  'CREATE_BOARD_DIALOG',
);

/// Opens the New board dialog (lazy) from outside the boards feature, for example the "Your first
/// project" walkthrough. Resolves with the created board after the sidebar's boards have reloaded,
/// or null when the user cancels.
@Injectable({ providedIn: 'root' })
export class BoardCreator {
  private readonly dialog = inject(MatDialog);
  private readonly api = inject(BoardsApi);
  private readonly directory = inject(BoardDirectory);
  private readonly loadDialog = inject(CREATE_BOARD_DIALOG, { optional: true });

  async open(prefill: CreateBoardPrefill = {}): Promise<Board | null> {
    if (!this.loadDialog) throw new Error('provideBoardCreation() is missing.');
    const component = await this.loadDialog();
    const ref = this.dialog.open<unknown, unknown, Board>(component, {
      data: {
        ...prefill,
        create: (board: NewBoard, idempotencyKey: string) =>
          firstValueFrom(this.api.create(board, idempotencyKey)),
      },
      width: '520px',
      autoFocus: 'first-tabbable',
    });
    const board = (await firstValueFrom(ref.afterClosed())) ?? null;
    if (board) await this.directory.reload();
    return board;
  }
}

export function provideBoardCreation(
  loadDialog: () => Promise<Type<unknown>>,
): EnvironmentProviders {
  return makeEnvironmentProviders([{ provide: CREATE_BOARD_DIALOG, useValue: loadDialog }]);
}
