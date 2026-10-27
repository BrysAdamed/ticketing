import { computed, inject, Injectable, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { LoadStatus } from '../projects/project-directory';
import { BoardsApi } from './boards.api';

export interface BoardLink {
  id: string;
  name: string;
}

const RECENT_KEY = 'tk-recent-boards';
const MAX_RECENT = 5;
const MAX_SHOWN = 8;
const OWNED_LIMIT = 20;

/// The sidebar's Boards section: boards the user opened recently (kept in localStorage), then the
/// active boards they own. Board pages call `visited()`; call `reload()` after creating, renaming,
/// archiving or deleting a board, and `forget()` when a board turns out to be gone.
@Injectable({ providedIn: 'root' })
export class BoardDirectory {
  private readonly api = inject(BoardsApi);

  private readonly recent = signal<readonly BoardLink[]>(readRecent());
  private readonly owned = signal<readonly BoardLink[]>([]);
  readonly status = signal<LoadStatus>('idle');

  readonly boards = computed<readonly BoardLink[]>(() => {
    const seen = new Set<string>();
    const result: BoardLink[] = [];
    for (const board of [...this.recent(), ...this.owned()]) {
      if (seen.has(board.id)) continue;
      seen.add(board.id);
      result.push(board);
    }
    return result.slice(0, MAX_SHOWN);
  });

  async load(): Promise<void> {
    if (this.status() === 'loading' || this.status() === 'loaded') return;
    await this.reload();
  }

  async reload(): Promise<void> {
    this.status.set('loading');
    try {
      const page = await firstValueFrom(this.api.list({ mine: true }, { limit: OWNED_LIMIT }));
      this.owned.set(page.items.map((b) => ({ id: b.id, name: b.name })));
      this.status.set('loaded');
    } catch {
      this.status.set('error');
    }
  }

  visited(board: BoardLink): void {
    this.updateRecent((list) => [{ id: board.id, name: board.name }, ...list.filter((b) => b.id !== board.id)].slice(0, MAX_RECENT));
  }

  forget(boardId: string): void {
    this.updateRecent((list) => list.filter((b) => b.id !== boardId));
    this.owned.update((list) => list.filter((b) => b.id !== boardId));
  }

  private updateRecent(change: (list: readonly BoardLink[]) => readonly BoardLink[]): void {
    const next = change(this.recent());
    this.recent.set(next);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // Storage can be unavailable (private mode); the list then lives for the session only.
    }
  }
}

function readRecent(): readonly BoardLink[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((b): b is BoardLink => typeof b?.id === 'string' && typeof b?.name === 'string').slice(0, MAX_RECENT)
      : [];
  } catch {
    return [];
  }
}
