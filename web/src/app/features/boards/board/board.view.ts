import { CdkDrag, CdkDragDrop, CdkDragPlaceholder, CdkDragStart, CdkDropList, CdkDropListGroup } from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, NavigationEnd, Params, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { BoardCard } from '@core/boards/board.models';
import { Breadcrumbs } from '@core/layout/breadcrumbs';
import { PeekService } from '@core/layout/peek/peek';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { TicketCreator } from '@core/tickets/create-ticket';
import { TicketCache } from '@core/tickets/ticket-cache';
import { TicketsApi } from '@core/tickets/tickets.api';
import { STATUS_CATEGORY_LABELS, statusCategory, TICKET_STATUS_LABELS, TICKET_STATUSES, TicketStatus } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { filter, firstValueFrom } from 'rxjs';
import { BOARD_ICONS } from '../board-icons';
import { AddTicketsDialog, AddTicketsDialogData } from './add-tickets.dialog';
import { BoardCardComponent } from './board-card.component';
import { BoardFiltersComponent } from './board-filters.component';
import { anchorFor, BoardFilters, EMPTY_FILTERS, filtersFromParams, filtersToParams, Lane, Swimlanes } from './board-logic';
import { BoardSettingsDialog } from './board-settings.dialog';
import { BoardStore } from './board.store';

interface CellData {
  status: TicketStatus;
  lane: string;
}

const SWIMLANE_OPTIONS: { value: Swimlanes; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'epic', label: 'Epic' },
];
const PREFETCH_DELAY_MS = 150;
const SKELETON_COLUMNS = [3, 2, 1, 2, 1, 1, 1, 2].map((n) => Array.from({ length: n }, (_, i) => i));

/// The kanban board (board.html): 8 status columns that scroll horizontally, optional swimlanes,
/// quick filters in the URL, CDK drag and drop between and within columns (optimistic, multi-select).
@Component({
  selector: 'tk-board-view',
  imports: [
    CdkDropListGroup,
    CdkDropList,
    CdkDrag,
    CdkDragPlaceholder,
    CdkScrollable,
    MatButtonModule,
    MatMenuModule,
    MatTooltip,
    RouterLink,
    AvatarComponent,
    BadgeComponent,
    ProjectTileComponent,
    StatusIconComponent,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    BoardCardComponent,
    BoardFiltersComponent,
  ],
  providers: [BoardStore],
  viewProviders: [provideIcons(BOARD_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page board-page', 'data-testid': 'view-board.kanban' },
  templateUrl: './board.view.html',
  styleUrl: './board.view.scss',
})
export class BoardView {
  protected readonly store = inject(BoardStore);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly peek = inject(PeekService);
  private readonly cache = inject(TicketCache);
  private readonly dialog = inject(MatDialog);
  private readonly creator = inject(TicketCreator);
  private readonly ticketsApi = inject(TicketsApi);
  private readonly breadcrumbs = inject(Breadcrumbs);

  readonly boardId = input.required<string>();

  protected readonly statuses = TICKET_STATUSES;
  protected readonly statusLabels = TICKET_STATUS_LABELS;
  protected readonly categoryLabels = STATUS_CATEGORY_LABELS;
  protected readonly categoryOf = statusCategory;
  protected readonly swimlaneOptions = SWIMLANE_OPTIONS;
  protected readonly skeletonColumns = SKELETON_COLUMNS;
  protected readonly dragging = signal<ReadonlySet<string>>(new Set());
  protected readonly filtersBar = viewChild(BoardFiltersComponent);

  protected readonly swimlaneLabel = computed(() => SWIMLANE_OPTIONS.find((o) => o.value === this.store.swimlanes())?.label ?? 'None');
  protected readonly filterUsers = computed(() => [...this.store.users().values()].sort((a, b) => a.displayName.localeCompare(b.displayName)));
  protected readonly gridColumns = computed(() => {
    const collapsed = this.store.collapsed();
    return TICKET_STATUSES.map((s) => (collapsed.has(s) ? '40px' : 'var(--tk-board-col-w)')).join(' ');
  });
  protected readonly highlightKey = this.peek.ticketKey;
  protected readonly collapsedLanes = signal<ReadonlySet<string>>(new Set());

  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Params });
  private readonly navigated = toSignal(this.router.events.pipe(filter((e) => e instanceof NavigationEnd)));
  private readonly enterPredicates = new Map<string, (drag: CdkDrag<BoardCard>) => boolean>();
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;
  private lastDropAt = 0;

  constructor() {
    effect(() => {
      const id = this.boardId();
      untracked(() => {
        this.readUrl(this.queryParams());
        void this.store.load(id);
      });
    });

    effect(() => {
      this.navigated();
      const name = this.store.board()?.name;
      if (name) untracked(() => this.breadcrumbs.setTail([{ label: name, url: null }]));
    });

    inject(ShortcutService).registerScoped([
      { keys: 'j', section: 'Board', description: 'Next card in the column', handler: () => this.focus('down') },
      { keys: 'k', section: 'Board', description: 'Previous card in the column', handler: () => this.focus('up') },
      { keys: 'h', section: 'Board', description: 'Previous column', handler: () => this.focus('left') },
      { keys: 'l', section: 'Board', description: 'Next column', handler: () => this.focus('right') },
      { keys: 'arrowdown', description: 'Next card', handler: () => this.focus('down'), showInHelp: false },
      { keys: 'arrowup', description: 'Previous card', handler: () => this.focus('up'), showInHelp: false },
      { keys: 'arrowleft', description: 'Previous column', handler: () => this.focus('left'), showInHelp: false },
      { keys: 'arrowright', description: 'Next column', handler: () => this.focus('right'), showInHelp: false },
      { keys: 'shift+h', section: 'Board', description: 'Move card to the previous status', handler: () => void this.store.shiftStatus(-1) },
      { keys: 'shift+l', section: 'Board', description: 'Move card to the next status', handler: () => void this.store.shiftStatus(1) },
      { keys: 'enter', section: 'Board', description: 'Open card', handler: () => this.openFocused(false) },
      { keys: 'shift+enter', section: 'Board', description: 'Open card full page', handler: () => this.openFocused(true) },
      { keys: 'x', section: 'Board', description: 'Select card', handler: () => this.toggleFocused() },
      { keys: '/', section: 'Board', description: 'Filter cards', handler: () => this.filtersBar()?.focusText() },
      { keys: 'escape', description: 'Clear selection', handler: () => this.store.clearSelection(), showInHelp: false },
    ]);
  }

  protected setFilters(filters: BoardFilters): void {
    this.store.filters.set(filters);
    this.writeUrl();
  }

  protected clearFilters(): void {
    this.setFilters(EMPTY_FILTERS);
  }

  protected setSwimlanes(swimlanes: Swimlanes): void {
    this.store.swimlanes.set(swimlanes);
    this.writeUrl();
  }

  protected toggleLane(key: string): void {
    this.collapsedLanes.update((set) => {
      const next = new Set(set);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  protected cellData(lane: Lane, status: TicketStatus): CellData {
    return { lane: lane.key, status };
  }

  protected enterPredicate(lane: string): (drag: CdkDrag<BoardCard>) => boolean {
    let predicate = this.enterPredicates.get(lane);
    if (!predicate) {
      predicate = (drag) => this.laneOf(drag.data.id) === lane;
      this.enterPredicates.set(lane, predicate);
    }
    return predicate;
  }

  protected dragStarted(event: CdkDragStart<BoardCard>): void {
    this.dragging.set(new Set(this.store.movingIds(event.source.data.id)));
  }

  protected async drop(event: CdkDragDrop<CellData, CellData, BoardCard>, lane: Lane): Promise<void> {
    this.lastDropAt = Date.now();
    const moving = this.dragging();
    this.dragging.set(new Set());
    const card = event.item.data;
    const target = event.container.data;
    if (event.previousContainer === event.container && event.previousIndex === event.currentIndex && moving.size <= 1) return;
    const ids = moving.size ? [...this.store.movingIds(card.id)] : [card.id];
    const anchor = anchorFor(lane.cells[target.status], card.id, event.currentIndex, new Set(ids));
    this.store.focusId.set(card.id);
    await this.store.move(ids, target.status, anchor);
  }

  protected clickCard(event: MouseEvent, card: BoardCard): void {
    if (Date.now() - this.lastDropAt < 150) return;
    if (event.ctrlKey || event.metaKey || event.shiftKey) {
      this.store.toggleSelect(card.id);
      return;
    }
    this.store.focusId.set(card.id);
    this.peek.open(card.key);
  }

  protected hover(key: string): void {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = setTimeout(() => this.cache.prefetch(key), PREFETCH_DELAY_MS);
  }

  protected unhover(): void {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = null;
  }

  protected openAddTickets(): void {
    const board = this.store.board();
    if (!board) return;
    const data: AddTicketsDialogData = {
      boardName: board.name,
      projects: board.projects.filter((p) => p.canWrite && !p.isArchived),
      add: (keys) => this.store.addFromBacklog(keys),
    };
    this.dialog.open<AddTicketsDialog, AddTicketsDialogData, string[]>(AddTicketsDialog, { data, width: '640px', autoFocus: 'first-tabbable' });
  }

  protected openSettings(): void {
    if (!this.store.board()) return;
    const ref = this.dialog.open(BoardSettingsDialog, { data: this.store, width: '600px', autoFocus: 'first-tabbable' });
    ref.afterClosed().subscribe((result) => {
      if (result === 'deleted') void this.router.navigate(['/boards']);
    });
  }

  protected async createIn(status: TicketStatus): Promise<void> {
    const board = this.store.board();
    const project = board?.projects.find((p) => p.canWrite && !p.isArchived);
    if (!board || !project) return;
    const created = await this.creator.open({
      projectKey: project.key,
      status,
      heading: `New ticket on ${board.name}`,
      submit: (projectKey, ticket) => firstValueFrom(this.ticketsApi.create(projectKey, { ...ticket, boardId: board.id } as typeof ticket)),
    });
    if (created) await this.store.reload(true);
  }

  protected sendSelectionToBacklog(): void {
    void this.store.sendToBacklog([...this.store.selection()]);
  }

  protected lanePoints(lane: Lane): string {
    return lane.points ? ` · ${lane.points} pts` : '';
  }

  private laneOf(cardId: string): string | null {
    for (const lane of this.store.lanes()) for (const status of TICKET_STATUSES) if (lane.cells[status].some((c) => c.id === cardId)) return lane.key;
    return null;
  }

  private focus(direction: 'up' | 'down' | 'left' | 'right'): void {
    const id = this.store.moveFocus(direction);
    if (!id) return;
    const card = this.store.cardById(id);
    if (card) document.querySelector(`[data-testid="board-card-${card.key}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  private openFocused(fullPage: boolean): void {
    const id = this.store.focusId();
    const card = id ? this.store.cardById(id) : undefined;
    if (!card) return;
    if (fullPage) void this.router.navigate(['/tickets', card.key]);
    else this.peek.open(card.key);
  }

  private toggleFocused(): void {
    const id = this.store.focusId();
    if (id) this.store.toggleSelect(id);
  }

  private readUrl(params: Params): void {
    this.store.filters.set(filtersFromParams(params));
    const lanes = params['lanes'];
    this.store.swimlanes.set(lanes === 'assignee' || lanes === 'epic' ? lanes : 'none');
  }

  private writeUrl(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        ...filtersToParams(this.store.filters()),
        lanes: this.store.swimlanes() === 'none' ? null : this.store.swimlanes(),
      },
    });
  }
}
