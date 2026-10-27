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
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { PeekService } from '@core/layout/peek/peek';
import { ConfirmService } from '@core/notify/confirm.service';
import { ProjectContext } from '@core/projects/project-context';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { FieldHints } from '@core/tickets/field-hints';
import { ProjectPeople } from '@core/tickets/project-people';
import { TicketCache } from '@core/tickets/ticket-cache';
import { UserRef } from '@core/tickets/ticket.models';
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
  userOptions,
} from '@shared/domain/picker-options';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { LabelsPickerDirective } from '@shared/ui/labels-picker/labels-picker.directive';
import { LabelToggle } from '@shared/ui/labels-picker/labels-picker-panel.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { BacklogFiltersComponent } from './backlog-filters.component';
import { BACKLOG_ICONS } from './backlog-icons';
import {
  BacklogFilters,
  EMPTY_FILTERS,
  GROUP_BY_OPTIONS,
  GroupBy,
  SORT_BY_OPTIONS,
  SortBy,
} from './backlog-logic';
import { BacklogRowComponent, RowEdit } from './backlog-row.component';
import { BacklogStore, CreateRow, ListRow } from './backlog.store';
import { QuickCreate, QuickCreateRowComponent } from './quick-create-row.component';

const PREFETCH_DELAY_MS = 150;

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
    MatTooltip,
    AvatarComponent,
    StatusIconComponent,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    InlinePickerDirective,
    KbdComponent,
    LabelsPickerDirective,
    SkeletonRowsComponent,
    BacklogFiltersComponent,
    BacklogRowComponent,
    QuickCreateRowComponent,
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
  private readonly confirm = inject(ConfirmService);
  protected readonly project = inject(ProjectContext);

  readonly projectKey = input.required<string>();

  protected readonly groupOptions = GROUP_BY_OPTIONS;
  protected readonly sortOptions = SORT_BY_OPTIONS;
  protected readonly statusOptions = TICKET_STATUS_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly rowHeight = computed(() => (this.theme.density() === 'compact' ? 28 : 32));
  protected readonly assignable = signal<readonly UserRef[]>([]);
  protected readonly assigneeOptions = computed(() => userOptions(this.assignable()));
  protected readonly labelOptions = signal<readonly string[]>([]);
  protected readonly versionOptions = signal<readonly string[]>([]);
  protected readonly creating = signal(false);
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
  protected readonly trackRow = (_: number, row: ListRow) => row.id;
  protected readonly labelSuggestions = (prefix: string) =>
    this.hints.get(this.store.projectKey(), 'labels', prefix);

  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly listWrap = viewChild<ElementRef<HTMLElement>>('listWrap');
  protected readonly listHeight = signal(480);
  private readonly filtersBar = viewChild(BacklogFiltersComponent);
  private readonly quickCreate = viewChild(QuickCreateRowComponent);
  private readonly queryParams = toSignal(this.route.queryParams, { initialValue: {} as Params });
  private movingIds: string[] = [];
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const key = this.projectKey();
      untracked(() => {
        this.readUrl(this.queryParams());
        void this.store.load(key);
        void this.people
          .assignable(key)
          .then((users) => this.assignable.set(users))
          .catch(() => undefined);
      });
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

    effect(() => {
      const focus = this.store.focusId();
      const viewport = this.viewport();
      if (!focus || !viewport) return;
      untracked(() => this.scrollIntoView(viewport, focus));
    });

    inject(ShortcutService).registerScoped([
      {
        keys: 'j',
        section: 'Backlog',
        description: 'Next ticket',
        handler: () => this.store.move(1),
      },
      {
        keys: 'k',
        section: 'Backlog',
        description: 'Previous ticket',
        handler: () => this.store.move(-1),
      },
      {
        keys: 'arrowdown',
        description: 'Next ticket',
        handler: () => this.store.move(1),
        showInHelp: false,
      },
      {
        keys: 'arrowup',
        description: 'Previous ticket',
        handler: () => this.store.move(-1),
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
        keys: 'a',
        section: 'Backlog',
        description: 'Assign to me',
        handler: () => this.assignToMe(),
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
    if (event.shiftKey) this.store.click(id, 'range');
    else if (event.ctrlKey || event.metaKey) this.store.click(id, 'toggle');
    else {
      this.store.click(id, 'single');
      this.store.clearSelection();
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
      case 'priority':
        void this.store.setPriority(ids, edit.value);
        break;
      case 'storyPoints':
        void this.store.setPoints(ids, edit.value);
        break;
      case 'assignee':
        void this.store.setAssignee(
          ids,
          edit.value
            ? (this.assignable().find((u) => u.id === edit.value) ??
                this.store.users().get(edit.value) ??
                null)
            : null,
        );
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

  protected bulkAssignee(userId: string | null): void {
    this.onEdit(this.store.selectedIds()[0], { field: 'assignee', value: userId });
  }

  protected bulkLabel(toggle: LabelToggle): void {
    void this.store.toggleLabel(this.store.selectedIds(), toggle.label, toggle.add);
  }

  protected async bulkDelete(): Promise<void> {
    const ids = this.store.selectedIds();
    const keys = ids.map((id) => this.store.item(id)?.key).filter(Boolean);
    const ok = await this.confirm.confirm({
      title: ids.length === 1 ? `Delete ${keys[0]}?` : `Delete ${ids.length} tickets?`,
      message: 'Deleted tickets disappear from every list and board. Their keys are never reused.',
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok) void this.store.remove(ids);
  }

  // Quick create

  protected async submitCreate(row: CreateRow, request: QuickCreate): Promise<void> {
    this.creating.set(true);
    const created = await this.store.quickCreate(request.title, request.type, row);
    this.creating.set(false);
    if (!created) return;
    if (request.open) {
      this.store.closeCreate();
      this.peek.open(created.key);
    } else {
      this.quickCreate()?.reset();
    }
  }

  // Drag and drop (CDK drag with our own drop index: rows have a fixed height, so the target row
  // is computed from the pointer; this works with virtual scrolling).

  protected dragStarted(event: CdkDragStart, id: string): void {
    const selected = this.store.selection().selected;
    this.movingIds = selected.has(id) ? this.store.selectedIds() : [id];
    this.dragCount.set(this.movingIds.length);
    event.source.element.nativeElement.blur();
  }

  protected dragMoved(event: CdkDragMove): void {
    this.dropIndex.set(this.indexAt(event.pointerPosition.y));
  }

  protected dragEnded(event: CdkDragEnd): void {
    const index = this.indexAt(event.dropPoint.y);
    event.source.reset();
    this.dropIndex.set(null);
    const ids = this.movingIds;
    this.movingIds = [];
    if (index !== null && ids.length) void this.store.drop(ids, index);
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

  private openFocused(fullPage: boolean): void {
    const id = this.store.focusId();
    const item = id ? this.store.item(id) : null;
    if (!item) return;
    if (fullPage) void this.router.navigate(['/tickets', item.key]);
    else this.peek.open(item.key);
  }

  private toggleFocused(): void {
    const id = this.store.focusId();
    if (id) this.store.click(id, 'toggle');
  }

  private assignToMe(): void {
    const ids = this.store.targets();
    if (ids.length && this.store.canWrite()) void this.store.assignToMe(ids);
  }

  private escape(): void {
    if (this.store.creatingIn() !== null) this.store.closeCreate();
    else if (this.selectionCount() > 0) this.store.clearSelection();
    else if (this.peek.isOpen()) this.peek.close();
  }

  /// The virtual list needs a definite height: fill the window below the toolbar.
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
    if (top < offset) viewport.scrollToOffset(top);
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
