import {
  CdkDrag,
  CdkDragEnd,
  CdkDragMove,
  CdkDragPlaceholder,
  CdkDragPreview,
  CdkDragStart,
  CdkDropList,
} from '@angular/cdk/drag-drop';
import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
  viewChildren,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { PeekService } from '@core/layout/peek/peek';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { ContextualHintComponent } from '@core/onboarding/hints/contextual-hint.component';
import { LearnActions } from '@core/onboarding/learn-actions';
import { ProjectContext } from '@core/projects/project-context';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { FieldHints } from '@core/tickets/field-hints';
import { MoveTarget, MoveTargets } from '@core/tickets/move-targets';
import { ProjectPeople } from '@core/tickets/project-people';
import { TicketCache } from '@core/tickets/ticket-cache';
import { TicketLocation, UserRef } from '@core/tickets/ticket.models';
import {
  Priority,
  PRIORITIES,
  TICKET_STATUSES,
  TICKET_TYPES,
  TicketStatus,
  TicketType,
} from '@shared/domain/enums';
import {
  PRIORITY_OPTIONS,
  TICKET_STATUS_OPTIONS,
  TICKET_TYPE_OPTIONS,
} from '@shared/domain/picker-options';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { LabelsPickerDirective } from '@shared/ui/labels-picker/labels-picker.directive';
import { LabelToggle } from '@shared/ui/labels-picker/labels-picker-panel.component';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { BacklogFiltersComponent } from './backlog-filters.component';
import { BACKLOG_ICONS } from './backlog-icons';
import {
  BacklogFilters,
  dragTargetAt,
  DragTarget,
  EMPTY_FILTERS,
  GROUP_BY_OPTIONS,
  GroupBy,
  SORT_BY_OPTIONS,
  SortBy,
  stickyGroupAt,
} from './backlog-logic';
import { BacklogRowComponent, RowEdit, RowPicker } from './backlog-row.component';
import { BacklogStore, CreateRow, isPending, ListRow } from './backlog.store';
import { QuickCreate, QuickCreateRowComponent } from './quick-create-row.component';

const PREFETCH_DELAY_MS = 150;
const PEEK_FOLLOW_MS = 120;
const ON_BOARDS_PANEL_PX = 40;
const BULK_BAR_CLEARANCE_PX = 72;
const BACKLOG_LOCATION: TicketLocation = { kind: 'Backlog', boardId: null, boardName: null };

@Component({
  selector: 'tk-backlog-view',
  imports: [
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    CdkDropList,
    CdkDrag,
    CdkDragPreview,
    CdkDragPlaceholder,
    MatButtonModule,
    MatMenuModule,
    MatSlideToggle,
    NgTemplateOutlet,
    MatTooltip,
    AvatarComponent,
    StatusIconComponent,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    InlinePickerDirective,
    KbdComponent,
    LabelsPickerDirective,
    SearchPickerDirective,
    SkeletonRowsComponent,
    BacklogFiltersComponent,
    BacklogRowComponent,
    QuickCreateRowComponent,
    TourAnchorDirective,
    ContextualHintComponent,
  ],
  providers: [BacklogStore],
  viewProviders: [provideIcons(BACKLOG_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-backlog.list' },
  templateUrl: './backlog.view.html',
  styleUrl: './backlog.view.scss',
})
export class BacklogView {
  protected readonly store = inject(BacklogStore);
  protected readonly peek = inject(PeekService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly theme = inject(ThemeService);
  private readonly cache = inject(TicketCache);
  private readonly hints = inject(FieldHints);
  private readonly people = inject(ProjectPeople);
  private readonly moveTargets = inject(MoveTargets);
  protected readonly project = inject(ProjectContext);
  protected readonly learn = inject(LearnActions);

  readonly projectKey = input.required<string>();

  protected readonly groupOptions = GROUP_BY_OPTIONS;
  protected readonly sortOptions = SORT_BY_OPTIONS;
  protected readonly statusOptions = TICKET_STATUS_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly rowHeight = computed(() => (this.theme.density() === 'compact' ? 28 : 32));
  protected readonly assigneeSearch = this.people.picker(() => this.store.projectKey());
  protected readonly labelOptions = signal<readonly string[]>([]);
  protected readonly versionOptions = signal<readonly string[]>([]);
  protected readonly typeOptions = TICKET_TYPE_OPTIONS;
  protected readonly dropIndex = signal<number | null>(null);
  protected readonly dragCount = signal(0);
  protected readonly filterUsers = computed(() =>
    [...this.store.users().values()].sort((a, b) => a.displayName.localeCompare(b.displayName)),
  );
  protected readonly groupLabel = computed(
    () => GROUP_BY_OPTIONS.find((o) => o.value === this.store.groupBy())?.label ?? '',
  );
  protected readonly sortLabel = computed(
    () => SORT_BY_OPTIONS.find((o) => o.value === this.store.sortBy())?.label ?? '',
  );
  protected readonly selectionCount = computed(() => this.store.selection().selected.size);
  protected readonly firstTicketId = computed(
    () => this.store.rows().find((row) => row.kind === 'ticket')?.id ?? null,
  );
  protected readonly trackRow = (_: number, row: ListRow) => row.id;
  protected readonly labelSuggestions = (prefix: string) =>
    this.hints.get(this.store.projectKey(), 'labels', prefix);

  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly rows = viewChildren(BacklogRowComponent);
  private readonly bulkStatusPicker =
    viewChild<InlinePickerDirective<TicketStatus>>('bulkStatusPicker');
  private readonly bulkPriorityPicker =
    viewChild<InlinePickerDirective<Priority>>('bulkPriorityPicker');
  private readonly bulkAssigneePicker =
    viewChild<SearchPickerDirective<UserRef | null>>('bulkAssigneePicker');
  private readonly bulkTypePicker = viewChild<InlinePickerDirective<TicketType>>('bulkTypePicker');
  private readonly bulkLabelsPicker = viewChild<LabelsPickerDirective>('bulkLabelsPicker');
  private readonly movePicker = viewChild<InlinePickerDirective<MoveTarget>>('movePicker');
  private moveOptions: readonly PickerOption<MoveTarget>[] = [];
  private moveIds: string[] = [];
  private readonly listWrap = viewChild<ElementRef<HTMLElement>>('listWrap');
  private readonly onBoardsPanel = viewChild<ElementRef<HTMLElement>>('onBoardsPanel');
  private readonly boardDrops = viewChildren<ElementRef<HTMLElement>>('boardDrop');
  /// Active boards linking this project, the drop targets of the "On boards" panel (writers only).
  protected readonly boards = signal<readonly PickerOption<MoveTarget>[]>([]);
  protected readonly dragging = signal(false);
  protected readonly dropBoard = signal<string | null>(null);
  protected readonly overPanel = signal(false);
  protected readonly showOnBoards = computed(
    () =>
      this.store.hasData() &&
      (this.store.onBoardsCount() > 0 || (this.store.canWrite() && this.boards().length > 0)),
  );
  protected readonly listHeight = signal(480);
  /// The list fills the window below the toolbar, minus the "On boards" panel and, while tickets
  /// are selected, the floating bulk bar, so the last rows can scroll above it.
  protected readonly viewportHeight = computed(() =>
    Math.max(
      160,
      this.listHeight() -
        (this.showOnBoards() ? ON_BOARDS_PANEL_PX : 0) -
        (this.selectionCount() > 0 ? BULK_BAR_CLEARANCE_PX : 0),
    ),
  );
  private readonly scrollTop = signal(0);
  protected readonly scrollbarWidth = signal(0);
  protected readonly stickyGroup = computed(() =>
    stickyGroupAt(this.store.rows(), this.scrollTop(), this.rowHeight()),
  );
  private readonly filtersBar = viewChild(BacklogFiltersComponent);
  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Params });
  private readonly injector = inject(Injector);
  private movingIds: string[] = [];
  private followTimer: ReturnType<typeof setTimeout> | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => {
        this.readUrl(this.queryParams());
        void this.store.load(key);
      });
    });

    effect(() => {
      const key = this.store.projectKey();
      const canWrite = this.store.canWrite();
      untracked(() => void this.loadBoards(canWrite ? key : null));
    });

    effect(() => {
      const wrap = this.listWrap();
      if (wrap) untracked(() => this.measure(wrap.nativeElement));
    });
    const onResize = () => {
      const wrap = this.listWrap();
      if (wrap) this.measure(wrap.nativeElement);
    };
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));

    effect((onCleanup) => {
      const viewport = this.viewport();
      if (!viewport) return;
      const subscription = viewport.elementScrolled().subscribe(() => {
        const element = viewport.elementRef.nativeElement;
        this.scrollTop.set(viewport.measureScrollOffset('top'));
        this.scrollbarWidth.set(element.offsetWidth - element.clientWidth);
      });
      onCleanup(() => subscription.unsubscribe());
    });

    effect(() => {
      const focus = this.store.focusId();
      const viewport = this.viewport();
      if (!focus || !viewport) return;
      untracked(() => this.scrollIntoView(viewport, focus));
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.followTimer) clearTimeout(this.followTimer);
    });

    effect(() => {
      this.viewportHeight();
      const viewport = this.viewport();
      if (viewport)
        afterNextRender(() => viewport.checkViewportSize(), { injector: this.injector });
    });

    inject(ShortcutService).registerScoped([
      {
        keys: 'j',
        section: 'Backlog',
        description: 'Next ticket',
        handler: () => this.step(1),
      },
      {
        keys: 'k',
        section: 'Backlog',
        description: 'Previous ticket',
        handler: () => this.step(-1),
      },
      {
        keys: 'arrowdown',
        description: 'Next ticket',
        handler: () => this.step(1),
        showInHelp: false,
      },
      {
        keys: 'arrowup',
        description: 'Previous ticket',
        handler: () => this.step(-1),
        showInHelp: false,
      },
      {
        keys: 'shift+j',
        section: 'Backlog',
        description: 'Extend selection down',
        handler: () => this.store.move(1, true),
      },
      {
        keys: 'shift+k',
        section: 'Backlog',
        description: 'Extend selection up',
        handler: () => this.store.move(-1, true),
      },
      {
        keys: 'shift+arrowdown',
        description: 'Extend selection down',
        handler: () => this.store.move(1, true),
        showInHelp: false,
      },
      {
        keys: 'shift+arrowup',
        description: 'Extend selection up',
        handler: () => this.store.move(-1, true),
        showInHelp: false,
      },
      {
        keys: 'enter',
        section: 'Backlog',
        description: 'Open ticket',
        handler: () => this.openFocused(false),
      },
      {
        keys: 'shift+enter',
        section: 'Backlog',
        description: 'Open ticket full page',
        handler: () => this.openFocused(true),
      },
      {
        keys: 'x',
        section: 'Backlog',
        description: 'Select ticket',
        handler: () => this.toggleFocused(),
      },
      {
        keys: 'c',
        section: 'Backlog',
        description: 'Quick-create ticket',
        handler: () => this.store.openCreate(null),
      },
      {
        keys: 's',
        section: 'Backlog',
        description: 'Change status',
        handler: () => this.openPicker('status'),
      },
      {
        keys: 'p',
        section: 'Backlog',
        description: 'Change priority',
        handler: () => this.openPicker('priority'),
      },
      {
        keys: 't',
        section: 'Backlog',
        description: 'Change type',
        handler: () => this.openPicker('type'),
      },
      {
        keys: 'a',
        section: 'Backlog',
        description: 'Assign to…',
        handler: () => this.openPicker('assignee'),
      },
      {
        keys: 'i',
        section: 'Backlog',
        description: 'Assign to me',
        handler: () => this.assignToMe(),
      },
      {
        keys: 'l',
        section: 'Backlog',
        description: 'Change labels',
        handler: () => this.openPicker('labels'),
      },
      {
        keys: 'm',
        section: 'Backlog',
        description: 'Move to board…',
        handler: () => void this.openMove(),
      },
      {
        keys: 'delete',
        section: 'Backlog',
        description: 'Delete ticket',
        handler: () => this.deleteTargets(),
      },
      {
        keys: 'mod+backspace',
        section: 'Backlog',
        description: 'Delete ticket',
        handler: () => this.deleteTargets(),
        showInHelp: false,
      },
      {
        keys: 'mod+a',
        section: 'Backlog',
        description: 'Select all',
        handler: () => this.store.selectAll(),
      },
      {
        keys: '/',
        section: 'Backlog',
        description: 'Filter by title or key',
        handler: () => this.filtersBar()?.focusText(),
      },
      {
        keys: 'escape',
        description: 'Clear selection',
        handler: () => this.escape(),
        showInHelp: false,
      },
    ]);
  }

  // Toolbar

  protected setFilters(filters: BacklogFilters): void {
    this.store.setFilters(filters);
    this.writeUrl();
  }

  protected setShowDone(showDone: boolean): void {
    this.setFilters({ ...this.store.filters(), showDone });
    if (showDone)
      this.store.collapsed.update((set) => new Set([...set].filter((g) => g !== 'status:Done')));
  }

  protected setGroupBy(groupBy: GroupBy): void {
    this.store.groupBy.set(groupBy);
    this.writeUrl();
  }

  protected setSortBy(sortBy: SortBy): void {
    this.store.sortBy.set(sortBy);
    this.writeUrl();
  }

  protected clearFilters(): void {
    this.setFilters({ ...EMPTY_FILTERS, showDone: this.store.filters().showDone });
  }

  protected loadLabelOptions(): void {
    void this.hints
      .get(this.store.projectKey(), 'labels')
      .then((labels) =>
        this.labelOptions.set([...new Set([...this.store.filters().labels, ...labels])]),
      );
  }

  protected loadVersionOptions(): void {
    void this.hints
      .get(this.store.projectKey(), 'version')
      .then((versions) => this.versionOptions.set(versions));
  }

  // Rows

  protected onRowClick(event: MouseEvent, id: string, key: string): void {
    if (isPending(id)) return;
    if (event.shiftKey) this.store.click(id, 'range');
    else if (event.ctrlKey || event.metaKey) this.store.click(id, 'toggle');
    else {
      this.store.focusId.set(id);
      this.peek.open(key);
    }
  }

  protected onRowHover(key: string | null): void {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = key ? setTimeout(() => this.cache.prefetch(key), PREFETCH_DELAY_MS) : null;
  }

  protected onEdit(id: string, edit: RowEdit): void {
    const ids = this.store.targets(id);
    switch (edit.field) {
      case 'status':
        void this.store.setStatus(ids, edit.value);
        break;
      case 'type':
        void this.store.setType(ids, edit.value);
        break;
      case 'priority':
        void this.store.setPriority(ids, edit.value);
        break;
      case 'storyPoints':
        void this.store.setPoints(ids, edit.value);
        break;
      case 'assignee':
        void this.store.setAssignee(ids, edit.value);
        break;
      case 'label':
        void this.store.toggleLabel(ids, edit.value.label, edit.value.add);
        break;
    }
  }

  protected userOf(id: string | null): UserRef | null {
    return id ? (this.store.users().get(id) ?? null) : null;
  }

  // Bulk bar

  protected bulkStatus(status: TicketStatus): void {
    void this.store.setStatus(this.store.selectedIds(), status);
  }

  protected bulkPriority(priority: Priority): void {
    void this.store.setPriority(this.store.selectedIds(), priority);
  }

  protected bulkAssignee(user: UserRef | null): void {
    this.onEdit(this.store.selectedIds()[0], { field: 'assignee', value: user });
  }

  protected bulkLabel(toggle: LabelToggle): void {
    void this.store.toggleLabel(this.store.selectedIds(), toggle.label, toggle.add);
  }

  protected bulkType(type: TicketType): void {
    void this.store.setType(this.store.selectedIds(), type);
  }

  protected bulkDelete(): void {
    void this.store.remove(this.store.selectedIds());
  }

  /// "Move to board" (bulk bar) and `M`: boards that link this project, under the bulk button or
  /// the focused row. The bulk bar moves the selection; `M` moves the keyboard targets.
  protected async openMove(origin?: Element): Promise<void> {
    const ids = origin ? this.store.selectedIds() : this.store.targets();
    if (!ids.length || !this.store.canWrite()) return;
    this.moveIds = ids;
    const anchor = origin ?? this.focusedRowElement();
    const options = await this.moveTargets.options(this.store.projectKey(), BACKLOG_LOCATION);
    this.moveOptions = options;
    this.movePicker()?.open(anchor ?? undefined, options);
  }

  protected moveTo(target: MoveTarget): void {
    const board = this.moveOptions.find((o) => o.value === target);
    const ids = this.moveIds;
    this.moveIds = [];
    if (!board || target === 'backlog' || !ids.length) return;
    void this.store.moveToBoard(ids, target, board.label);
  }

  // "On boards" panel: each board is a drop target and, for the keyboard and screen readers, a
  // button that moves the selection there (like the bulk bar's "Move to board").

  protected moveSelectionTo(board: PickerOption<MoveTarget>): void {
    const ids = this.store.selectedIds();
    if (ids.length && this.store.canWrite())
      void this.store.moveToBoard(ids, board.value, board.label);
  }

  protected boardDropLabel(board: PickerOption<MoveTarget>): string {
    const n = this.selectionCount();
    return n > 0
      ? `Move ${n} selected ${n === 1 ? 'ticket' : 'tickets'} to ${board.label}`
      : `${board.label}: select tickets or drag them here to move them`;
  }

  private async loadBoards(projectKey: string | null): Promise<void> {
    if (!projectKey) {
      this.boards.set([]);
      return;
    }
    const options = await this.moveTargets
      .options(projectKey, BACKLOG_LOCATION)
      .catch((): PickerOption<MoveTarget>[] => []);
    if (this.store.projectKey() === projectKey)
      this.boards.set(options.filter((o) => o.value !== 'backlog'));
  }

  private dragTarget(x: number, y: number): DragTarget {
    const box = (element: HTMLElement) => element.getBoundingClientRect();
    const panel = this.onBoardsPanel()?.nativeElement;
    return dragTargetAt(
      x,
      y,
      panel ? box(panel) : null,
      this.boardDrops().map((ref) => ({
        id: ref.nativeElement.dataset['boardId'] ?? '',
        box: box(ref.nativeElement),
      })),
    );
  }

  // Quick create

  protected async submitCreate(row: CreateRow, request: QuickCreate): Promise<void> {
    if (request.open) this.store.closeCreate();
    const created = await this.store.quickCreate(request.title, request.type, row);
    if (created && request.open) this.peek.open(created.key);
  }

  protected isPending(id: string): boolean {
    return isPending(id);
  }

  // Drag and drop (CDK drag with our own drop index: rows have a fixed height, so the target row
  // is computed from the pointer; this works with virtual scrolling).

  /// A drag carries the selection when the dragged row is in it, otherwise only that row (the
  /// targets rule of the keyboard shortcuts, D-172).
  protected dragStarted(event: CdkDragStart, id: string): void {
    this.movingIds = this.store.targets(id);
    this.dragCount.set(this.movingIds.length);
    this.dragging.set(true);
    event.source.element.nativeElement.blur();
  }

  /// The row preview is locked to the vertical axis, so CDK reports a constrained x; the board
  /// under the pointer is found with the real pointer position.
  protected dragMoved(event: CdkDragMove): void {
    const point = 'touches' in event.event ? event.event.touches[0] : event.event;
    const y = event.pointerPosition.y;
    const target = this.dragTarget(point?.clientX ?? event.pointerPosition.x, y);
    this.dropBoard.set(target.kind === 'board' ? target.boardId : null);
    this.overPanel.set(target.kind !== 'list');
    this.dropIndex.set(target.kind === 'list' ? this.indexAt(y) : null);
  }

  protected dragEnded(event: CdkDragEnd): void {
    const { x, y } = event.dropPoint;
    const target = this.dragTarget(x, y);
    const index = target.kind === 'list' ? this.indexAt(y) : null;
    event.source.reset();
    this.dropIndex.set(null);
    this.dropBoard.set(null);
    this.overPanel.set(false);
    this.dragging.set(false);
    const ids = this.movingIds;
    this.movingIds = [];
    if (!ids.length) return;
    if (target.kind === 'board') {
      const board = this.boards().find((b) => b.value === target.boardId);
      if (board) void this.store.moveToBoard(ids, board.value, board.label);
    } else if (index !== null) void this.store.drop(ids, index);
  }

  protected dropLineTop(): number {
    const index = this.dropIndex();
    const viewport = this.viewport();
    if (index === null || !viewport) return -1;
    return index * this.rowHeight() - viewport.measureScrollOffset();
  }

  private indexAt(clientY: number): number | null {
    const viewport = this.viewport();
    if (!viewport) return null;
    const rect = viewport.elementRef.nativeElement.getBoundingClientRect();
    const y = clientY - rect.top + viewport.measureScrollOffset();
    return Math.max(0, Math.min(this.store.rows().length, Math.round(y / this.rowHeight())));
  }

  // Keyboard

  /// j / k / ↑ / ↓: moves the focus; an open peek follows it after a short pause.
  private step(delta: 1 | -1): void {
    this.store.move(delta);
    if (this.followTimer) clearTimeout(this.followTimer);
    this.followTimer = null;
    const focus = this.store.focusId();
    const key = focus && !isPending(focus) ? this.store.item(focus)?.key : undefined;
    if (!this.peek.isOpen() || !key || this.peek.ticketKey() === key) return;
    this.cache.prefetch(key);
    this.followTimer = setTimeout(() => {
      if (this.peek.isOpen()) this.peek.open(key);
    }, PEEK_FOLLOW_MS);
  }

  private openFocused(fullPage: boolean): void {
    const id = this.store.focusId();
    const item = id && !isPending(id) ? this.store.item(id) : null;
    if (!item) return;
    if (fullPage) void this.router.navigate(['/tickets', item.key]);
    else this.peek.open(item.key);
  }

  private toggleFocused(): void {
    const id = this.store.focusId();
    if (id) this.store.click(id, 'toggle');
  }

  /// s / p / t / a / l: the bulk bar picker when tickets are selected, otherwise the focused row's.
  private openPicker(field: RowPicker): void {
    if (!this.store.canWrite()) return;
    if (this.selectionCount()) {
      switch (field) {
        case 'status':
          return this.bulkStatusPicker()?.open();
        case 'priority':
          return this.bulkPriorityPicker()?.open();
        case 'type':
          return this.bulkTypePicker()?.open();
        case 'assignee':
          return this.bulkAssigneePicker()?.open();
        case 'labels':
          return this.bulkLabelsPicker()?.open();
      }
    }
    this.focusedRow()?.openPicker(field);
  }

  private assignToMe(): void {
    const ids = this.store.targets();
    if (ids.length && this.store.canWrite()) void this.store.assignToMe(ids);
  }

  private deleteTargets(): void {
    if (!this.project.isOwner() || !this.store.canWrite()) return;
    const ids = this.store.targets();
    if (ids.length) void this.store.remove(ids);
  }

  private focusedRow(): BacklogRowComponent | undefined {
    const focus = this.store.focusId();
    return this.rows().find((row) => row.item().id === focus);
  }

  private focusedRowElement(): Element | null {
    const key = this.store.item(this.store.focusId() ?? '')?.key;
    return key
      ? (this.viewport()?.elementRef.nativeElement.querySelector(
          `[data-testid="backlog-row-${key}"]`,
        ) ?? null)
      : null;
  }

  private escape(): void {
    if (this.store.creatingIn() !== null) this.store.closeCreate();
    else if (this.selectionCount() > 0) this.store.clearSelection();
    else if (this.peek.isOpen()) this.peek.close();
  }

  /// The virtual list needs a definite height: fill the window below the toolbar.
  protected remeasure(): void {
    const wrap = this.listWrap();
    if (wrap) this.measure(wrap.nativeElement);
  }

  private measure(element: HTMLElement): void {
    requestAnimationFrame(() =>
      this.listHeight.set(Math.max(240, window.innerHeight - element.getBoundingClientRect().top)),
    );
  }

  private scrollIntoView(viewport: CdkVirtualScrollViewport, id: string): void {
    const index = this.store.rows().findIndex((r) => r.id === id);
    if (index < 0) return;
    const height = this.rowHeight();
    const top = index * height;
    const offset = viewport.measureScrollOffset();
    const size = viewport.getViewportSize();
    const pinned = this.store.groupBy() === 'none' ? 0 : height;
    if (top < offset + pinned) viewport.scrollToOffset(Math.max(0, top - pinned));
    else if (top + height > offset + size) viewport.scrollToOffset(top + height - size);
  }

  // URL state (filters, grouping and sort live in the URL so a view can be bookmarked, I-21)

  private readUrl(params: Params): void {
    const list = (name: string, allowed: readonly string[]) =>
      String(params[name] ?? '')
        .split(',')
        .filter((v) => allowed.includes(v));
    const filters: BacklogFilters = {
      ...EMPTY_FILTERS,
      showDone: params['done'] === '1',
      types: list('type', TICKET_TYPES) as TicketType[],
      statuses: list('status', TICKET_STATUSES) as TicketStatus[],
      priorities: list('priority', PRIORITIES) as Priority[],
      assignee: params['assignee'] ?? null,
      labels: String(params['label'] ?? '')
        .split(',')
        .filter(Boolean),
      version: params['version'] ?? null,
      text: params['q'] ?? '',
    };
    this.store.filters.set(filters);
    const group = GROUP_BY_OPTIONS.find((o) => o.value === params['group'])?.value;
    if (group) this.store.groupBy.set(group);
    const sort = SORT_BY_OPTIONS.find((o) => o.value === params['sort'])?.value;
    if (sort) this.store.sortBy.set(sort);
    if (filters.showDone) this.store.collapsed.set(new Set());
  }

  private writeUrl(): void {
    const f = this.store.filters();
    const join = (values: readonly string[]) => (values.length ? values.join(',') : null);
    void this.router.navigate([], {
      relativeTo: this.route,
      replaceUrl: true,
      queryParamsHandling: 'merge',
      queryParams: {
        done: f.showDone ? '1' : null,
        type: join(f.types),
        status: join(f.statuses),
        priority: join(f.priorities),
        assignee: f.assignee,
        label: join(f.labels),
        version: f.version,
        q: f.text.trim() || null,
        group: this.store.groupBy() === 'status' ? null : this.store.groupBy(),
        sort: this.store.sortBy() === 'rank' ? null : this.store.sortBy(),
      },
    });
  }
}
