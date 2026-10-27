import {
  CdkDrag,
  CdkDragDrop,
  CdkDragPlaceholder,
  CdkDragStart,
  CdkDropList,
  CdkDropListGroup,
} from '@angular/cdk/drag-drop';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
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
import { ProjectPeople } from '@core/tickets/project-people';
import { TicketCache } from '@core/tickets/ticket-cache';
import { UserRef } from '@core/tickets/ticket.models';
import {
  Priority,
  STATUS_CATEGORY_LABELS,
  statusCategory,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TicketStatus,
} from '@shared/domain/enums';
import { PRIORITY_OPTIONS, TICKET_STATUS_OPTIONS } from '@shared/domain/picker-options';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import { filter } from 'rxjs';
import { BOARD_ICONS } from '../board-icons';
import { AddTicketsDialog, AddTicketsDialogData } from './add-tickets.dialog';
import { BoardCardComponent } from './board-card.component';
import { BoardFiltersComponent } from './board-filters.component';
import {
  anchorFor,
  BoardFilters,
  EMPTY_FILTERS,
  filtersFromParams,
  filtersToParams,
  Lane,
  parseSwimlanes,
  statusOf,
  Swimlanes,
} from './board-logic';
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
  { value: 'project', label: 'Project' },
  { value: 'priority', label: 'Priority' },
];
const PREFETCH_DELAY_MS = 150;
const SKELETON_COLUMNS = [3, 2, 1, 2, 1, 1, 1, 2].map((n) =>
  Array.from({ length: n }, (_, i) => i),
);

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
    PriorityIconComponent,
    ProjectTileComponent,
    StatusIconComponent,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    BoardCardComponent,
    BoardFiltersComponent,
    InlinePickerDirective,
    SearchPickerDirective,
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
  private readonly breadcrumbs = inject(Breadcrumbs);
  private readonly people = inject(ProjectPeople);

  readonly boardId = input.required<string>();

  protected readonly statuses = TICKET_STATUSES;
  protected readonly statusLabels = TICKET_STATUS_LABELS;
  protected readonly categoryLabels = STATUS_CATEGORY_LABELS;
  protected readonly categoryOf = statusCategory;
  protected readonly swimlaneOptions = computed(() =>
    (this.store.board()?.projects.length ?? 0) > 1 || this.store.swimlanes() === 'project'
      ? SWIMLANE_OPTIONS
      : SWIMLANE_OPTIONS.filter((o) => o.value !== 'project'),
  );
  protected readonly skeletonColumns = SKELETON_COLUMNS;
  protected readonly dragging = signal<ReadonlySet<string>>(new Set());
  protected readonly filtersBar = viewChild(BoardFiltersComponent);
  protected readonly statusOptions = TICKET_STATUS_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly focusedStatus = computed(() => {
    const id = this.store.focusId();
    return id ? statusOf(this.store.columns(), id) : null;
  });
  protected readonly focusedPriority = computed(() => {
    const id = this.store.focusId();
    return id ? (this.store.cardById(id)?.priority ?? null) : null;
  });
  protected readonly assigneeSearch = this.people.picker(() => this.editProjectKey);
  private readonly cards = viewChildren(BoardCardComponent);
  private readonly statusPicker = viewChild<InlinePickerDirective<TicketStatus>>('kbStatusPicker');
  private readonly priorityPicker = viewChild<InlinePickerDirective<Priority>>('kbPriorityPicker');
  private readonly assigneePicker =
    viewChild<SearchPickerDirective<UserRef | null>>('kbAssigneePicker');
  private editIds: string[] = [];
  private editProjectKey = '';

  protected readonly swimlaneLabel = computed(
    () => SWIMLANE_OPTIONS.find((o) => o.value === this.store.swimlanes())?.label ?? 'None',
  );
  protected readonly filterUsers = computed(() =>
    [...this.store.users().values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  protected readonly gridColumns = computed(() => {
    const collapsed = this.store.collapsed();
    return TICKET_STATUSES.map((s) => (collapsed.has(s) ? '40px' : 'var(--tk-board-col-w)')).join(
      ' ',
    );
  });
  protected readonly highlightKey = this.peek.ticketKey;
  protected readonly collapsedLanes = signal<ReadonlySet<string>>(new Set());

  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Params });
  private readonly navigated = toSignal(
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)),
  );
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
      {
        keys: 'j',
        section: 'Board',
        description: 'Next card in the column',
        handler: () => this.focus('down'),
      },
      {
        keys: 'k',
        section: 'Board',
        description: 'Previous card in the column',
        handler: () => this.focus('up'),
      },
      {
        keys: 'h',
        section: 'Board',
        description: 'Previous column',
        handler: () => this.focus('left'),
      },
      {
        keys: 'l',
        section: 'Board',
        description: 'Next column',
        handler: () => this.focus('right'),
      },
      {
        keys: 'arrowdown',
        description: 'Next card',
        handler: () => this.focus('down'),
        showInHelp: false,
      },
      {
        keys: 'arrowup',
        description: 'Previous card',
        handler: () => this.focus('up'),
        showInHelp: false,
      },
      {
        keys: 'arrowleft',
        description: 'Previous column',
        handler: () => this.focus('left'),
        showInHelp: false,
      },
      {
        keys: 'arrowright',
        description: 'Next column',
        handler: () => this.focus('right'),
        showInHelp: false,
      },
      {
        keys: 'shift+h',
        section: 'Board',
        description: 'Move card to the previous status',
        handler: () => void this.store.shiftStatus(-1),
      },
      {
        keys: 'shift+l',
        section: 'Board',
        description: 'Move card to the next status',
        handler: () => void this.store.shiftStatus(1),
      },
      {
        keys: 'enter',
        section: 'Board',
        description: 'Open card',
        handler: () => this.openFocused(false),
      },
      {
        keys: 'shift+enter',
        section: 'Board',
        description: 'Open card full page',
        handler: () => this.openFocused(true),
      },
      {
        keys: 'x',
        section: 'Board',
        description: 'Select card',
        handler: () => this.toggleFocused(),
      },
      {
        keys: 's',
        section: 'Board',
        description: 'Change status',
        handler: () => this.openPicker('status'),
      },
      {
        keys: 'p',
        section: 'Board',
        description: 'Change priority',
        handler: () => this.openPicker('priority'),
      },
      {
        keys: 'a',
        section: 'Board',
        description: 'Assign to…',
        handler: () => this.openPicker('assignee'),
      },
      {
        keys: 'i',
        section: 'Board',
        description: 'Assign to me',
        handler: () => void this.store.assignToMe(this.store.editTargets()),
      },
      {
        keys: '/',
        section: 'Board',
        description: 'Filter cards',
        handler: () => this.filtersBar()?.focusText(),
      },
      {
        keys: 'escape',
        description: 'Clear selection',
        handler: () => this.store.clearSelection(),
        showInHelp: false,
      },
    ]);
  }

  protected pickStatus(status: TicketStatus): void {
    const columns = this.store.columns();
    const ids = this.editIds.filter((id) => statusOf(columns, id) !== status);
    if (ids.length) void this.store.move(ids, status, {});
  }

  protected pickPriority(priority: Priority): void {
    void this.store.setPriority(this.editIds, priority);
  }

  protected pickAssignee(user: UserRef | null): void {
    void this.store.setAssignee(this.editIds, user);
  }

  /// s / p / a: a picker under the focused card for it, or for the selection when there is one.
  private openPicker(field: 'status' | 'priority' | 'assignee'): void {
    const ids = this.store.editTargets();
    if (!ids.length) return;
    this.editIds = ids;
    this.editProjectKey = this.store.cardById(ids[0])?.projectKey ?? '';
    const focus = this.store.focusId();
    const anchorId = focus && ids.includes(focus) ? focus : ids[0];
    const origin = this.cards().find((c) => c.card().id === anchorId)?.element.nativeElement;
    if (field === 'status') this.statusPicker()?.open(origin);
    else if (field === 'priority') this.priorityPicker()?.open(origin);
    else this.assigneePicker()?.open(origin);
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

  protected async drop(
    event: CdkDragDrop<CellData, CellData, BoardCard>,
    lane: Lane,
  ): Promise<void> {
    this.lastDropAt = Date.now();
    const moving = this.dragging();
    this.dragging.set(new Set());
    const card = event.item.data;
    const target = event.container.data;
    if (
      event.previousContainer === event.container &&
      event.previousIndex === event.currentIndex &&
      moving.size <= 1
    )
      return;
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
      add: (keys, childCounts) => this.store.addFromBacklog(keys, childCounts),
    };
    this.dialog.open<AddTicketsDialog, AddTicketsDialogData, string[]>(AddTicketsDialog, {
      data,
      width: '640px',
      autoFocus: 'first-tabbable',
    });
  }

  protected openSettings(): void {
    if (!this.store.board()) return;
    const ref = this.dialog.open(BoardSettingsDialog, {
      data: this.store,
      width: '600px',
      autoFocus: 'first-tabbable',
    });
    ref.afterClosed().subscribe((result) => {
      if (result === 'deleted') void this.router.navigate(['/boards']);
    });
  }

  protected async createIn(status: TicketStatus): Promise<void> {
    const board = this.store.board();
    const project = board?.projects.find((p) => p.canWrite && !p.isArchived);
    if (!board || !project) return;
    await this.creator.open({
      projectKey: project.key,
      status,
      boardId: board.id,
      heading: `New ticket on ${board.name}`,
    });
  }

  protected sendSelectionToBacklog(): void {
    void this.store.sendToBacklog([...this.store.selection()]);
  }

  protected lanePoints(lane: Lane): string {
    return lane.points ? ` · ${lane.points} pts` : '';
  }

  private laneOf(cardId: string): string | null {
    for (const lane of this.store.lanes())
      for (const status of TICKET_STATUSES)
        if (lane.cells[status].some((c) => c.id === cardId)) return lane.key;
    return null;
  }

  private focus(direction: 'up' | 'down' | 'left' | 'right'): void {
    const id = this.store.moveFocus(direction);
    if (!id) return;
    const card = this.store.cardById(id);
    if (card)
      document
        .querySelector(`[data-testid="board-card-${card.key}"]`)
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
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
    this.store.swimlanes.set(parseSwimlanes(lanes));
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
