import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page, PageRequest } from '../api/page';
import { TicketSummary } from '../tickets/ticket.models';
import {
  ArchiveBoardResult,
  Board,
  BoardListQuery,
  BoardPatch,
  BoardSummary,
  CarryOverTarget,
  MoveTicketsRequest,
  NewBoard,
} from './board.models';

/// Typed client for the boards REST API. `move` also serves backlog moves from other features
/// (for example "Move to board…" in the backlog or the ticket view).
@Injectable({ providedIn: 'root' })
export class BoardsApi {
  private readonly api = inject(ApiClient);

  list(query: BoardListQuery = {}, page?: PageRequest): Observable<Page<BoardSummary>> {
    return this.api.list<BoardSummary>('/boards', page, { ...query });
  }

  get(boardId: string): Observable<Board> {
    return this.api.get<Board>(`/boards/${boardId}`);
  }

  create(board: NewBoard, idempotencyKey?: string): Observable<Board> {
    return this.api.post<Board>('/boards', board, { idempotencyKey });
  }

  update(boardId: string, patch: BoardPatch, rowVersion?: number): Observable<Board> {
    return this.api.patch<Board>(`/boards/${boardId}`, patch, { rowVersion });
  }

  archive(boardId: string, carryOverTo: CarryOverTarget): Observable<ArchiveBoardResult> {
    return this.api.post<ArchiveBoardResult>(`/boards/${boardId}/archive`, { carryOverTo });
  }

  unarchive(boardId: string): Observable<Board> {
    return this.api.post<Board>(`/boards/${boardId}/unarchive`);
  }

  delete(boardId: string): Observable<void> {
    return this.api.delete(`/boards/${boardId}`);
  }

  move(request: MoveTicketsRequest): Observable<TicketSummary[]> {
    return this.api.post<TicketSummary[]>('/tickets/move', request);
  }
}
