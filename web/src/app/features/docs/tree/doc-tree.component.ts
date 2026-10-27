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
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule, MatMenuTrigger } from '@angular/material/menu';
import { Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerLayoutSidebarLeftCollapse } from '@ng-icons/tabler-icons';
import { docsHomeUrl, docUrl } from '@core/docs/doc-links';
import { DiagramFormat, DOC_ROOT, DocKind, DocTreeItem } from '@core/docs/doc.models';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';
import { AutofocusSelectDirective } from './autofocus-select.directive';
import {
  CreateRow,
  DropTarget,
  dropTargetAt,
  NodeRow,
  rowTooltip,
  TreeRow,
} from './doc-tree-logic';
import { DocTreeStore, isPendingKey, KIND_LABELS } from './doc-tree.store';

export const TREE_ROW_HEIGHT = 28;
const HOVER_EXPAND_MS = 500;
const SECTION = 'Docs';
const SKELETON = [0, 1, 1, 1, 0, 1, 2, 2, 0, 0].map((depth, i) => ({
  depth,
  width: [62, 48, 70, 55, 66, 52, 44, 60, 74, 50][i],
}));

/// The Docs tree panel (docs-page.html): filter, virtual-scrolled rows, drag and drop with drop
/// indicators, inline create and rename, context menu, Move to… picker and keyboard navigation.
@Component({
  selector: 'tk-doc-tree',
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
    RouterLink,
    IconComponent,
    KbdComponent,
    InlinePickerDirective,
    AutofocusSelectDirective,
  ],
  viewProviders: [provideIcons({ ...DOCS_ICONS, tablerLayoutSidebarLeftCollapse })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'doc-tree' },
  templateUrl: './doc-tree.component.html',
  styleUrl: './doc-tree.component.scss',
})
export class DocTreeComponent {
  protected readonly store = inject(DocTreeStore);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  readonly collapseTitle = input('Hide the tree');
  readonly collapse = output<void>();

  protected readonly rowHeight = TREE_ROW_HEIGHT;
  protected readonly docIcon = docIcon;
  protected readonly rowTooltip = rowTooltip;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly skeleton = SKELETON;
  protected readonly homeUrl = computed(() => docsHomeUrl(this.store.projectKey()));
  protected readonly trashUrl = computed(() => `${this.homeUrl()}/trash`);
  protected readonly activeDescendant = computed(() => {
    const key = this.store.cursorKey();
    return key ? `doc-node-${key}` : null;
  });
  protected readonly trackRow = (_: number, row: TreeRow) =>
    row.type === 'node' ? row.item.key : `create:${row.parentKey ?? ''}`;

  protected readonly dropTarget = signal<DropTarget | null>(null);
  protected readonly dropInvalid = signal(false);
  protected readonly dragging = signal<DocTreeItem | null>(null);
  protected readonly menuItem = signal<DocTreeItem | null>(null);
  protected readonly menuPosition = signal({ x: 0, y: 0 });
  protected readonly createTitle = signal('');
  protected readonly createProblem = computed(() => {
    const draft = this.store.creating();
    const title = this.createTitle();
    return draft && title.trim() ? this.store.titleProblem(title, draft.parentKey) : null;
  });

  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly filterInput = viewChild<ElementRef<HTMLInputElement>>('filterInput');
  private readonly menuTrigger = viewChild<MatMenuTrigger>('menuTrigger');
  private readonly movePicker = viewChild<InlinePickerDirective<string>>('movePicker');
  private moveKey: string | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverFolder: string | null = null;

  constructor() {
    effect(() => {
      const key = this.store.cursorKey();
      const viewport = this.viewport();
      if (key && viewport) untracked(() => this.scrollIntoView(viewport, key));
    });
    effect(() => {
      if (!this.store.creating()) untracked(() => this.createTitle.set(''));
    });
    effect(() => {
      const request = this.store.menuRequest();
      if (!request) return;
      untracked(() => {
        this.store.menuRequest.set(null);
        const item = this.store.item(request.key);
        if (item) this.showMenu(item, request.x, request.y);
      });
    });
    inject(DestroyRef).onDestroy(() => this.clearHover());
    this.registerShortcuts();
  }

  focusTree(): void {
    this.viewport()?.elementRef.nativeElement.focus();
    if (!this.store.cursorKey()) this.store.step(1);
  }

  focusFilter(): void {
    const input = this.filterInput()?.nativeElement;
    input?.focus();
    input?.select();
  }

  // Rows

  protected isNode(row: TreeRow): row is NodeRow {
    return row.type === 'node';
  }

  protected asCreate(row: TreeRow): CreateRow {
    return row as CreateRow;
  }

  protected isPending(key: string): boolean {
    return isPendingKey(key);
  }

  protected open(item: DocTreeItem): void {
    if (isPendingKey(item.key)) return;
    this.store.cursorKey.set(item.key);
    this.viewport()?.elementRef.nativeElement.focus({ preventScroll: true });
    if (item.kind === 'Folder') {
      const active = this.store.activeKey() === item.key;
      this.store.toggle(item.key, active ? undefined : true);
    }
    void this.router.navigateByUrl(docUrl(item.key, item.title));
  }

  protected toggle(event: Event, item: DocTreeItem): void {
    event.stopPropagation();
    this.store.cursorKey.set(item.key);
    this.store.toggle(item.key);
  }

  protected onTreeKeydown(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const target = event.target as HTMLElement;
    const onRow = target !== event.currentTarget;
    if (onRow && (target.getAttribute('role') !== 'treeitem' || event.key === 'Enter')) return;
    const handled: Record<string, () => void> = {
      ArrowDown: () => this.store.step(1),
      ArrowUp: () => this.store.step(-1),
      ArrowRight: () => this.store.expandOrEnter(),
      ArrowLeft: () => this.store.collapseOrLeave(),
      Home: () => this.stepTo(0),
      End: () => this.stepTo(-1),
      Enter: () => {
        const cursor = this.store.cursor();
        if (cursor) this.open(cursor);
      },
    };
    const action = handled[event.key];
    if (!action) return;
    event.preventDefault();
    action();
  }

  // Create and rename

  protected startCreate(kind: DocKind, parentKey?: string | null): void {
    this.store.startCreate(kind, parentKey === undefined ? this.store.currentFolder() : parentKey);
  }

  protected setFormat(event: Event, format: DiagramFormat): void {
    event.preventDefault();
    this.store.setCreateFormat(format);
  }

  protected async submitCreate(): Promise<void> {
    const draft = this.store.creating();
    const problem = this.store.titleProblem(this.createTitle(), draft?.parentKey ?? null);
    if (problem) {
      this.toast.warning(problem);
      return;
    }
    const doc = await this.store.submitCreate(this.createTitle());
    if (doc && doc.kind !== 'Folder') {
      const startDrawing = doc.diagramFormat === 'Canvas' ? '?mode=edit' : '';
      void this.router.navigateByUrl(`${docUrl(doc.key, doc.title)}${startDrawing}`);
    } else this.focusTree();
  }

  protected onCreateKeydown(event: KeyboardEvent): void {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.submitCreate();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.store.cancelCreate();
      this.focusTree();
    }
  }

  protected onCreateFocusOut(event: FocusEvent, row: HTMLElement): void {
    const next = event.relatedTarget as Node | null;
    if (next && row.contains(next)) return;
    if (this.createTitle().trim() && !this.createProblem()) void this.submitCreate();
    else this.store.cancelCreate();
  }

  protected async submitRename(item: DocTreeItem, input: HTMLInputElement): Promise<void> {
    if (this.store.renamingKey() !== item.key) return;
    const title = await this.store.submitRename(item.key, input.value);
    if (title && this.store.activeKey() === item.key)
      void this.router.navigateByUrl(docUrl(item.key, title), { replaceUrl: true });
  }

  protected onRenameKeydown(event: KeyboardEvent, item: DocTreeItem, input: HTMLInputElement) {
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      void this.submitRename(item, input).then(() => this.focusTree());
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.store.cancelRename();
      this.focusTree();
    }
  }

  // Context menu and actions

  protected openMenu(event: MouseEvent, item: DocTreeItem): void {
    event.preventDefault();
    event.stopPropagation();
    if (isPendingKey(item.key)) return;
    this.store.cursorKey.set(item.key);
    const anchor = event.type === 'contextmenu' ? null : (event.currentTarget as HTMLElement);
    const rect = anchor?.getBoundingClientRect();
    this.showMenu(item, rect ? rect.left : event.clientX, rect ? rect.bottom : event.clientY);
  }

  protected rename(item: DocTreeItem): void {
    this.store.startRename(item.key);
  }

  protected duplicate(item: DocTreeItem): void {
    void this.store.duplicate(item.key).then((doc) => {
      if (doc) void this.router.navigateByUrl(docUrl(doc.key, doc.title));
    });
  }

  protected async delete(item: DocTreeItem): Promise<void> {
    const active = this.store.activeKey();
    const leaving = !!active && this.store.contains(item.key, active);
    const parent = item.parentKey ? this.store.item(item.parentKey) : null;
    const removed = await this.store.delete(item.key);
    if (leaving && removed.length)
      void this.router.navigateByUrl(parent ? docUrl(parent.key, parent.title) : this.homeUrl());
  }

  protected copyLink(item: DocTreeItem): void {
    const url = `${location.origin}${docUrl(item.key, item.title)}`;
    void navigator.clipboard
      .writeText(url)
      .then(() => this.toast.success(`Link to ${item.key} copied`))
      .catch(() => this.toast.error("Couldn't copy the link"));
  }

  protected openMove(item: DocTreeItem, origin?: Element): void {
    if (!this.store.canWrite() || isPendingKey(item.key)) return;
    this.moveKey = item.key;
    const options: PickerOption<string>[] = [
      {
        value: DOC_ROOT,
        label: 'Docs (top level)',
        icon: { kind: 'icon', name: 'tablerFolder' },
        disabled: item.parentKey === null,
      },
      ...this.store.folders().map((folder) => {
        const path = [...this.store.pathOf(folder.key), folder.title].join(' / ');
        return {
          value: folder.key,
          label: path,
          keywords: [folder.title],
          icon: { kind: 'icon' as const, name: 'tablerFolder' },
          disabled:
            folder.key === item.parentKey ||
            !!this.store.moveProblem(item.key, { parent: folder.key, position: 'Bottom' }),
        };
      }),
    ];
    this.movePicker()?.open(origin ?? this.rowElement(item.key) ?? undefined, options);
  }

  protected moveTo(parent: string): void {
    const key = this.moveKey;
    this.moveKey = null;
    if (key) void this.store.move(key, { parent, position: 'Bottom' });
  }

  // Drag and drop (CDK drag with our own drop target computed from the pointer: rows have a fixed
  // height, so this works with virtual scrolling).

  protected dragStarted(event: CdkDragStart, item: DocTreeItem): void {
    this.dragging.set(item);
    this.store.cursorKey.set(item.key);
    event.source.element.nativeElement.blur();
  }

  protected dragMoved(event: CdkDragMove): void {
    const target = this.targetAt(event.pointerPosition.y);
    const item = this.dragging();
    this.dropTarget.set(target);
    this.dropInvalid.set(
      !!item && !!target && !!this.store.moveProblem(item.key, target.placement),
    );
    this.hoverExpand(target?.folderKey ?? null);
  }

  protected dragEnded(event: CdkDragEnd): void {
    const target = this.targetAt(event.dropPoint.y);
    const item = this.dragging();
    event.source.reset();
    this.dragging.set(null);
    this.dropTarget.set(null);
    this.dropInvalid.set(false);
    this.clearHover();
    if (item && target) void this.store.move(item.key, target.placement);
  }

  protected dropLineTop(): number {
    const target = this.dropTarget();
    const viewport = this.viewport();
    if (!target || target.lineIndex === null || !viewport) return -1;
    return target.lineIndex * this.rowHeight - viewport.measureScrollOffset();
  }

  private targetAt(clientY: number): DropTarget | null {
    const viewport = this.viewport();
    if (!viewport) return null;
    const rect = viewport.elementRef.nativeElement.getBoundingClientRect();
    if (clientY < rect.top - this.rowHeight || clientY > rect.bottom + this.rowHeight) return null;
    const y = clientY - rect.top + viewport.measureScrollOffset();
    return dropTargetAt(this.store.rows(), y, this.rowHeight);
  }

  private hoverExpand(folderKey: string | null): void {
    if (folderKey === this.hoverFolder) return;
    this.clearHover();
    this.hoverFolder = folderKey;
    if (!folderKey || this.store.expanded().has(folderKey)) return;
    this.hoverTimer = setTimeout(() => this.store.toggle(folderKey, true), HOVER_EXPAND_MS);
  }

  private clearHover(): void {
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    this.hoverFolder = null;
  }

  private showMenu(item: DocTreeItem, x: number, y: number): void {
    this.menuItem.set(item);
    this.menuPosition.set({ x, y });
    const trigger = this.menuTrigger();
    if (!trigger) return;
    if (trigger.menuOpen) trigger.closeMenu();
    setTimeout(() => trigger.openMenu());
  }

  private stepTo(index: 0 | -1): void {
    const nodes = this.store.rows().filter((r): r is NodeRow => r.type === 'node');
    const row = index === 0 ? nodes[0] : nodes[nodes.length - 1];
    if (row) this.store.cursorKey.set(row.item.key);
  }

  private rowElement(key: string): HTMLElement | null {
    return (
      this.viewport()?.elementRef.nativeElement.querySelector<HTMLElement>(
        `[data-testid="doc-row-${key}"]`,
      ) ?? null
    );
  }

  private scrollIntoView(viewport: CdkVirtualScrollViewport, key: string): void {
    const index = this.store.rows().findIndex((r) => r.type === 'node' && r.item.key === key);
    if (index < 0) return;
    const top = index * this.rowHeight;
    const offset = viewport.measureScrollOffset();
    const size = viewport.getViewportSize();
    if (top < offset) viewport.scrollToOffset(top);
    else if (size > 0 && top + this.rowHeight > offset + size)
      viewport.scrollToOffset(top + this.rowHeight - size);
  }

  private withCursor(run: (item: DocTreeItem) => void): () => void {
    return () => {
      const cursor = this.store.cursor();
      if (cursor && !isPendingKey(cursor.key)) run(cursor);
    };
  }

  private registerShortcuts(): void {
    inject(ShortcutService).registerScoped([
      {
        keys: 'n',
        section: SECTION,
        description: 'New page in the current folder',
        handler: () => this.startCreate('Page'),
      },
      {
        keys: 'shift+n',
        section: SECTION,
        description: 'New folder in the current folder',
        handler: () => this.startCreate('Folder'),
      },
      {
        keys: 'shift+d',
        section: SECTION,
        description: 'New diagram in the current folder',
        handler: () => this.startCreate('Diagram'),
      },
      {
        keys: '/',
        section: SECTION,
        description: 'Filter the tree',
        handler: () => this.focusFilter(),
      },
      {
        keys: 'j',
        section: SECTION,
        description: 'Next doc in the tree',
        handler: () => this.store.step(1),
      },
      {
        keys: 'k',
        section: SECTION,
        description: 'Previous doc in the tree',
        handler: () => this.store.step(-1),
      },
      {
        keys: 'mod+shift+e',
        section: SECTION,
        description: 'Focus the tree',
        handler: () => this.focusTree(),
        allowInInputs: true,
      },
      {
        keys: 'f2',
        section: SECTION,
        description: 'Rename',
        handler: this.withCursor((item) => this.store.startRename(item.key)),
      },
      {
        keys: 'm',
        section: SECTION,
        description: 'Move to…',
        handler: this.withCursor((item) => this.openMove(item)),
      },
      {
        keys: 'alt+arrowup',
        section: SECTION,
        description: 'Move up among its siblings',
        handler: () => this.store.reorder(-1),
      },
      {
        keys: 'alt+arrowdown',
        section: SECTION,
        description: 'Move down among its siblings',
        handler: () => this.store.reorder(1),
      },
      {
        keys: 'delete',
        section: SECTION,
        description: 'Delete (with Undo)',
        handler: this.withCursor((item) => void this.delete(item)),
      },
      {
        keys: 'mod+backspace',
        section: SECTION,
        description: 'Delete (with Undo)',
        handler: this.withCursor((item) => void this.delete(item)),
        showInHelp: false,
      },
      {
        keys: 'shift+f10',
        section: SECTION,
        description: 'Open the context menu',
        handler: this.withCursor((item) => {
          const rect = this.rowElement(item.key)?.getBoundingClientRect();
          if (rect) this.showMenu(item, rect.left + 24, rect.bottom);
        }),
      },
    ]);
  }
}
