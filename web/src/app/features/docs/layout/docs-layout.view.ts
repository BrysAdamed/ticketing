import { DOCUMENT } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { DocTreeComponent } from '../tree/doc-tree.component';
import { DocTreeStore } from '../tree/doc-tree.store';

const WIDTH_KEY = 'tk-docs-tree-width';
const MIN_WIDTH = 200;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 280;

/// Frame of the Docs section (spec 1.1): the per-project tree panel on the left (280 px,
/// resizable 200–480 px, width remembered) and the routed content (home, a doc, trash) on the
/// right. It owns the `DocTreeStore` every Docs view shares.
@Component({
  selector: 'tk-docs-layout-view',
  imports: [RouterOutlet, DocTreeComponent],
  providers: [DocTreeStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'view-docs.layout',
    '[style.--tree-w.px]': 'width()',
  },
  template: `
    <tk-doc-tree class="tree" />
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
    .tree {
      border-right: 1px solid var(--tk-border);
      min-width: 0;
      min-height: 0;
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

  readonly projectKey = input.required<string>();

  protected readonly minWidth = MIN_WIDTH;
  protected readonly maxWidth = MAX_WIDTH;
  protected readonly width = signal(this.readWidth());

  constructor() {
    effect(() => {
      const key = this.projectKey().toUpperCase();
      untracked(() => void this.store.load(key));
    });
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
    if (!save) return;
    try {
      this.storage?.setItem(WIDTH_KEY, String(this.width()));
    } catch {
      return;
    }
  }

  private readWidth(): number {
    try {
      const value = Number(this.storage?.getItem(WIDTH_KEY));
      return value >= MIN_WIDTH && value <= MAX_WIDTH ? value : DEFAULT_WIDTH;
    } catch {
      return DEFAULT_WIDTH;
    }
  }
}
