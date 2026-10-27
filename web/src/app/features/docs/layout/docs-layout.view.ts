import { DOCUMENT } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  Injector,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerLayoutSidebarLeftExpand } from '@ng-icons/tabler-icons';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DocTreeComponent } from '../tree/doc-tree.component';
import { DocTreeStore } from '../tree/doc-tree.store';

const WIDTH_KEY = 'tk-docs-tree-width';
const COLLAPSED_KEY = 'tk-docs-tree-collapsed';
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;
export const TREE_TOGGLE_KEYS = 'mod+\\';

/// Frame of the Docs section (spec 1.1): the per-project tree panel on the left (280 px,
/// resizable 200–480 px, collapsible with `Ctrl \`, width and collapsed state remembered) and the
/// routed content (home, a doc, trash) on the right. It owns the `DocTreeStore` every Docs view
/// shares.
@Component({
  selector: 'tk-docs-layout-view',
  imports: [RouterOutlet, DocTreeComponent, IconComponent],
  providers: [DocTreeStore],
  viewProviders: [provideIcons({ tablerLayoutSidebarLeftExpand })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'view-docs.layout',
    '[class.collapsed]': 'collapsed()',
    '[style.--tree-w.px]': 'width()',
  },
  template: `
    @if (collapsed()) {
      <div class="rail">
        <button
          type="button"
          class="tk-icon-btn"
          aria-label="Show the tree"
          data-testid="doc-tree-expand"
          [title]="toggleTitle('Show the tree')"
          (click)="toggle()"
        >
          <tk-icon name="tablerLayoutSidebarLeftExpand" [size]="16" />
        </button>
      </div>
    } @else {
      <tk-doc-tree
        class="tree"
        [collapseTitle]="toggleTitle('Hide the tree')"
        (collapse)="toggle()"
      />
      <div
        class="resize"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize the tree"
        tabindex="0"
        [attr.aria-valuenow]="width()"
        [attr.aria-valuemin]="minWidth"
        [attr.aria-valuemax]="maxWidth"
        (pointerdown)="startResize($event)"
        (keydown.arrowleft)="resizeBy(-16)"
        (keydown.arrowright)="resizeBy(16)"
      ></div>
    }
    <section class="content" aria-label="Docs content">
      <router-outlet />
    </section>
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: var(--tree-w) 0 minmax(0, 1fr);
      height: calc(100vh - var(--tk-topbar-h));
      min-height: 0;
    }
    :host(.collapsed) {
      grid-template-columns: 40px minmax(0, 1fr);
    }
    .tree {
      border-right: 1px solid var(--tk-border);
      min-width: 0;
      min-height: 0;
    }
    .rail {
      display: flex;
      justify-content: center;
      padding-top: 6px;
      border-right: 1px solid var(--tk-border);
      background: var(--tk-bg);
    }
    .resize {
      position: relative;
      z-index: 2;
      width: 7px;
      margin-left: -4px;
      cursor: col-resize;
    }
    .resize:hover,
    .resize:focus-visible {
      background: var(--tk-accent-border);
      outline: none;
    }
    .content {
      min-width: 0;
      min-height: 0;
      overflow: auto;
    }
  `,
})
export class DocsLayoutView {
  private readonly store = inject(DocTreeStore);
  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly shortcuts = inject(ShortcutService);
  private readonly injector = inject(Injector);
  private readonly tree = viewChild(DocTreeComponent);

  readonly projectKey = input.required<string>();

  protected readonly minWidth = MIN_WIDTH;
  protected readonly maxWidth = MAX_WIDTH;
  protected readonly width = signal(this.readWidth());
  protected readonly collapsed = signal(this.read(COLLAPSED_KEY) === 'true');

  constructor() {
    effect(() => {
      const key = this.projectKey().toUpperCase();
      untracked(() => void this.store.load(key));
    });
    this.shortcuts.registerScoped([
      {
        keys: TREE_TOGGLE_KEYS,
        section: 'Docs',
        description: 'Show or hide the tree',
        handler: () => this.toggle(),
      },
      {
        keys: 'mod+shift+e',
        section: 'Docs',
        description: 'Focus the tree',
        showInHelp: false,
        allowInInputs: true,
        handler: () => {
          if (this.collapsed()) this.toggle(true);
        },
      },
    ]);
  }

  protected toggleTitle(label: string): string {
    return `${label} (${this.shortcuts.format(TREE_TOGGLE_KEYS).join(' ')})`;
  }

  protected toggle(focusTree = false): void {
    this.collapsed.update((value) => !value);
    this.write(COLLAPSED_KEY, String(this.collapsed()));
    if (!this.collapsed() && focusTree)
      afterNextRender(() => this.tree()?.focusTree(), { injector: this.injector });
  }

  protected startResize(event: PointerEvent): void {
    const handle = event.target as HTMLElement;
    const startX = event.clientX;
    const startWidth = this.width();
    handle.setPointerCapture(event.pointerId);
    const move = (e: PointerEvent) => this.setWidth(startWidth + e.clientX - startX, false);
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      this.setWidth(this.width(), true);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  }

  protected resizeBy(delta: number): void {
    this.setWidth(this.width() + delta, true);
  }

  private setWidth(value: number, save: boolean): void {
    this.width.set(Math.round(Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))));
    if (save) this.write(WIDTH_KEY, String(this.width()));
  }

  private readWidth(): number {
    const value = Number(this.read(WIDTH_KEY));
    return value >= MIN_WIDTH && value <= MAX_WIDTH ? value : DEFAULT_WIDTH;
  }

  private read(key: string): string | null {
    try {
      return this.storage?.getItem(key) ?? null;
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      this.storage?.setItem(key, value);
    } catch {
      return;
    }
  }
}
