import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { ApiError, toApiError } from '@core/api/api-error';
import { AuthService } from '@core/auth/auth.service';
import { BoardSummary, NewBoard, Board } from '@core/boards/board.models';
import { BoardDirectory } from '@core/boards/board-directory';
import { BoardsApi } from '@core/boards/boards.api';
import { LoadStatus } from '@core/projects/project-directory';
import { Page } from '@core/api/page';

export type BoardsFilter = 'active' | 'mine' | 'archived';

const PAGE_SIZE = 100;
const MAX_PAGES = 10;

/// All boards the user can see (D-07), active and archived, filtered in the browser.
@Injectable()
export class BoardsStore {
  private readonly api = inject(BoardsApi);
  private readonly auth = inject(AuthService);
  private readonly directory = inject(BoardDirectory);

  readonly status = signal<LoadStatus>('idle');
  readonly error = signal<ApiError | null>(null);
  readonly items = signal<readonly BoardSummary[]>([]);
  readonly query = signal('');
  readonly filter = signal<BoardsFilter>('active');

  readonly hasData = computed(() => this.status() === 'loaded' || this.items().length > 0);
  readonly counts = computed(() => {
    const me = this.auth.currentUser()?.id;
    const items = this.items();
    return {
      active: items.filter((b) => !b.archivedAt).length,
      mine: items.filter((b) => !b.archivedAt && b.owner.id === me).length,
      archived: items.filter((b) => b.archivedAt).length,
    };
  });
  readonly boards = computed(() => {
    const me = this.auth.currentUser()?.id;
    const filter = this.filter();
    const text = this.query().trim().toLowerCase();
    return this.items().filter((b) => {
      if (filter === 'archived' ? !b.archivedAt : b.archivedAt) return false;
      if (filter === 'mine' && b.owner.id !== me) return false;
      return !text || b.name.toLowerCase().includes(text) || b.projects.some((p) => p.key.toLowerCase().includes(text));
    });
  });

  async load(): Promise<void> {
    this.status.set(this.items().length ? 'loaded' : 'loading');
    try {
      const items: BoardSummary[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < MAX_PAGES; page++) {
        const result: Page<BoardSummary> = await firstValueFrom(this.api.list({ includeArchived: true }, { limit: PAGE_SIZE, cursor }));
        items.push(...result.items);
        cursor = result.nextCursor;
        if (!cursor) break;
      }
      this.items.set(items);
      this.error.set(null);
      this.status.set('loaded');
    } catch (error) {
      this.error.set(toApiError(error));
      this.status.set('error');
    }
  }

  async create(board: NewBoard, idempotencyKey: string): Promise<Board> {
    const created = await firstValueFrom(this.api.create(board, idempotencyKey));
    void this.directory.reload();
    return created;
  }
}
