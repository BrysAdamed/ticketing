import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { BoardsApi } from '../boards/boards.api';
import { TicketLocation } from './ticket.models';

const BOARD_LIMIT = 100;
const FRESH_MS = 60_000;

/// Value of a "Move to…" option: `backlog` or a board id (the `target` of `POST /tickets/move`).
export type MoveTarget = 'backlog' | string;

/// Where a project's tickets can be moved: its backlog and the active boards that link it. Used by
/// the `M` shortcut and the backlog's "Move to board" bulk action.
@Injectable({ providedIn: 'root' })
export class MoveTargets {
  private readonly api = inject(BoardsApi);
  private readonly boards = new Map<string, { at: number; request: Promise<BoardTarget[]> }>();

  /// Options for tickets currently at `current`, which is left out.
  async options(
    projectKey: string,
    current: TicketLocation | null,
  ): Promise<PickerOption<MoveTarget>[]> {
    const boards = await this.boardsOf(projectKey);
    const options: PickerOption<MoveTarget>[] = [
      {
        value: 'backlog',
        label: 'Backlog',
        keywords: ['backlog'],
        icon: { kind: 'icon', name: 'tablerList' },
      },
      ...boards.map((board) => ({
        value: board.id,
        label: board.name,
        icon: { kind: 'icon' as const, name: 'tablerLayoutKanban' },
      })),
    ];
    const currentTarget = current
      ? current.kind === 'Backlog'
        ? 'backlog'
        : current.boardId
      : null;
    return options.filter((o) => o.value !== currentTarget);
  }

  private boardsOf(projectKey: string): Promise<BoardTarget[]> {
    const key = projectKey.toUpperCase();
    const cached = this.boards.get(key);
    if (cached && Date.now() - cached.at < FRESH_MS) return cached.request;
    const request = firstValueFrom(this.api.list({ projectKey: key }, { limit: BOARD_LIMIT })).then(
      (page) => page.items.filter((b) => !b.archivedAt).map((b) => ({ id: b.id, name: b.name })),
    );
    request.catch(() => this.boards.delete(key));
    this.boards.set(key, { at: Date.now(), request });
    return request;
  }
}

interface BoardTarget {
  id: string;
  name: string;
}
