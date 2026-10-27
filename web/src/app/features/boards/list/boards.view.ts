import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { Board } from '@core/boards/board.models';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { BoardsFilter, BoardsStore } from './boards.store';
import { CreateBoardDialog, CreateBoardDialogData } from './create-board.dialog';

/// All boards (spec 5.4, D-07): cards with linked projects, visible card counts and the owner.
@Component({
  selector: 'tk-boards-view',
  imports: [
    RouterLink,
    MatButtonModule,
    MatTooltip,
    AvatarComponent,
    ProjectTileComponent,
    EmptyStateComponent,
    IconComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
  ],
  providers: [BoardsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-boards.list' },
  template: `
    <header class="tk-page-header">
      <h1>Boards</h1>
      <span class="tk-page-count">{{ store.counts().active }}</span>
      <div class="tk-page-actions">
        <button mat-stroked-button type="button" data-testid="boards-new" (click)="openCreate()">
          <tk-icon name="tablerPlus" [size]="14" />New board
        </button>
      </div>
    </header>

    <div class="tk-toolbar">
      <label class="filter">
        <tk-icon name="tablerSearch" [size]="14" />
        <input
          type="search"
          placeholder="Filter by name or project"
          aria-label="Filter boards"
          data-testid="boards-filter"
          [value]="store.query()"
          (input)="store.query.set($any($event.target).value)"
        />
      </label>
      <tk-segmented
        ariaLabel="Board filter"
        testId="boards-segment"
        [options]="filterOptions()"
        [value]="store.filter()"
        (valueChange)="store.filter.set($event)"
      />
    </div>

    @if (store.status() === 'error' && !store.hasData()) {
      <tk-empty-state
        icon="tablerAlertCircle"
        tone="danger"
        title="Couldn't load boards"
        [description]="store.error()?.title ?? null"
      >
        <button mat-stroked-button type="button" (click)="store.load()">Retry</button>
      </tk-empty-state>
    } @else if (!store.hasData()) {
      <tk-skeleton-rows [count]="6" />
    } @else {
      <div class="grid">
        @for (board of store.boards(); track board.id) {
          <a
            class="board"
            [class.archived]="board.archivedAt"
            [routerLink]="['/boards', board.id]"
            [attr.data-testid]="'board-row-' + board.name"
          >
            <div class="top">
              <tk-icon name="tablerLayoutKanban" [size]="16" />
              <span class="name">{{ board.name }}</span>
              @if (board.archivedAt) {
                <span class="tag">Archived</span>
              }
            </div>
            @if (board.description) {
              <p class="desc">{{ board.description }}</p>
            }
            <div class="projects">
              @for (project of board.projects; track project.id) {
                <span class="pchip" [matTooltip]="project.name"
                  ><tk-project-tile [projectKey]="project.key" />{{ project.key }}</span
                >
              }
            </div>
            <div class="bottom">
              <span class="progress" [attr.aria-label]="progressLabel(board.counts)">
                @let total = board.counts.toDo + board.counts.inProgress + board.counts.done;
                @if (total) {
                  <span class="seg todo" [style.flex-grow]="board.counts.toDo"></span>
                  <span class="seg inprogress" [style.flex-grow]="board.counts.inProgress"></span>
                  <span class="seg done" [style.flex-grow]="board.counts.done"></span>
                }
              </span>
              <span class="counts tnum" [matTooltip]="progressLabel(board.counts)">
                {{ board.counts.toDo }} · {{ board.counts.inProgress }} · {{ board.counts.done }}
              </span>
              <span class="owner" [matTooltip]="'Owner: ' + board.owner.displayName">
                <tk-avatar [userId]="board.owner.id" [name]="board.owner.displayName" />
              </span>
            </div>
          </a>
        } @empty {
          <div class="empty">
            @if (store.query() || store.filter() !== 'active') {
              <tk-empty-state
                icon="tablerSearch"
                title="No boards match"
                description="Try another filter."
              />
            } @else {
              <tk-empty-state
                icon="tablerLayoutKanban"
                title="No boards yet"
                description="A board pulls tickets from one or more project backlogs, like a sprint."
              >
                <button mat-stroked-button type="button" (click)="openCreate()">New board</button>
              </tk-empty-state>
            }
          </div>
        }
      </div>
    }
  `,
  styles: `
    .mat-mdc-button-base tk-icon {
      margin-right: 4px;
    }
    .filter {
      height: 24px;
      width: 240px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      margin-right: 6px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text-subtle);
    }
    .filter:focus-within {
      border-color: var(--tk-accent);
    }
    .filter input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
      font-size: var(--tk-text-sm);
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
      gap: 12px;
      padding: 16px 24px 48px;
    }
    .board {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 14px 14px 12px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      background: var(--tk-surface);
      box-shadow: var(--tk-shadow-xs);
      color: var(--tk-text);
      text-decoration: none;
      transition: border-color var(--tk-duration-instant);
    }
    .board:hover {
      border-color: var(--tk-border-strong);
    }
    .board.archived {
      background: var(--tk-bg-subtle);
      box-shadow: none;
    }
    .top {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--tk-text-muted);
    }
    .name {
      flex: 1;
      min-width: 0;
      color: var(--tk-text);
      font-weight: var(--tk-weight-semibold);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tag {
      height: 20px;
      display: inline-flex;
      align-items: center;
      padding: 0 8px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-bg-muted);
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
    }
    .desc {
      margin: 0;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }
    .projects {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      min-height: 22px;
    }
    .pchip {
      height: 22px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px 0 4px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-full);
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
      color: var(--tk-text-muted);
    }
    .bottom {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: auto;
    }
    .progress {
      flex: 1;
      height: 6px;
      display: flex;
      gap: 2px;
      border-radius: var(--tk-radius-full);
      background: var(--tk-bg-muted);
      overflow: hidden;
    }
    .seg {
      flex-basis: 0;
    }
    .seg.todo {
      background: var(--tk-category-todo);
      opacity: 0.45;
    }
    .seg.inprogress {
      background: var(--tk-category-inprogress);
    }
    .seg.done {
      background: var(--tk-category-done);
    }
    .counts {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
    }
    .empty {
      grid-column: 1 / -1;
    }
  `,
})
export class BoardsView {
  protected readonly store = inject(BoardsStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  protected readonly filterOptions = computed<SegmentOption<BoardsFilter>[]>(() => {
    const counts = this.store.counts();
    return [
      { value: 'active', label: 'Active', count: counts.active },
      { value: 'mine', label: 'Mine', count: counts.mine },
      { value: 'archived', label: 'Archived', count: counts.archived },
    ];
  });

  constructor() {
    void this.store.load();
    inject(ShortcutService).registerScoped([
      { keys: 'n', section: 'Boards', description: 'New board', handler: () => this.openCreate() },
    ]);
  }

  protected progressLabel(counts: { toDo: number; inProgress: number; done: number }): string {
    return `${counts.toDo} to do, ${counts.inProgress} in progress, ${counts.done} done`;
  }

  protected openCreate(): void {
    const data: CreateBoardDialogData = { create: (board, key) => this.store.create(board, key) };
    const ref = this.dialog.open<CreateBoardDialog, CreateBoardDialogData, Board>(
      CreateBoardDialog,
      {
        data,
        width: '520px',
        autoFocus: 'first-tabbable',
      },
    );
    ref.afterClosed().subscribe((board) => {
      if (board) void this.router.navigate(['/boards', board.id]);
    });
  }
}
