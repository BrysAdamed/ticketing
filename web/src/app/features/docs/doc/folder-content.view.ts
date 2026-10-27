import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { docUrl } from '@core/docs/doc-links';
import { Doc, DocKind } from '@core/docs/doc.models';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';
import { DocTreeStore, isPendingKey } from '../tree/doc-tree.store';

/// A folder (`docs.folder`): its title and its docs in tree order, live from the tree, or the
/// "This folder is empty" state with the create actions (spec 1.17).
@Component({
  selector: 'tk-doc-folder-content',
  imports: [
    RouterLink,
    MatButtonModule,
    IconComponent,
    KbdComponent,
    EmptyStateComponent,
    RelativeTimePipe,
  ],
  viewProviders: [provideIcons(DOCS_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.folder' },
  template: `
    <div class="pbody">
      <h1 class="ptitle" data-testid="doc-title">{{ doc().title }}</h1>
      @if (children().length === 0) {
        <tk-empty-state
          icon="tablerFolder"
          title="This folder is empty"
          data-testid="doc-folder-empty"
          [description]="tree.canWrite() ? 'Add a page, a folder or a diagram.' : null"
        >
          @if (tree.canWrite()) {
            <button mat-flat-button type="button" (click)="create('Page')">
              New page <tk-kbd tone="on-solid">N</tk-kbd>
            </button>
            <button mat-stroked-button type="button" (click)="create('Folder')">New folder</button>
            <button mat-stroked-button type="button" (click)="create('Diagram')">
              New diagram
            </button>
          }
        </tk-empty-state>
      } @else {
        <div class="lst" data-testid="doc-folder-children">
          @for (child of children(); track child.key) {
            <a class="lr" [routerLink]="url(child.key, child.title)">
              <tk-icon class="i" [name]="icon(child.kind, child.diagramFormat)" [size]="16" />
              <span class="t">{{ child.title }}</span>
              @if (child.kind === 'Folder') {
                <span class="p tnum"
                  >{{ child.childCount }} {{ child.childCount === 1 ? 'item' : 'items' }}</span
                >
              } @else {
                <span class="p"></span>
              }
              <span class="w">{{ child.updatedAt | relativeTime }}</span>
            </a>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .pbody {
      max-width: 808px;
      margin: 0 auto;
      padding: 32px 48px 64px;
    }
    .ptitle {
      margin: 0 0 24px;
      font-size: var(--tk-text-2xl);
      line-height: var(--tk-leading-2xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
      overflow-wrap: anywhere;
    }
    .lst {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
      background: var(--tk-surface);
    }
    .lr {
      height: var(--tk-row-h);
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      border-top: 1px solid var(--tk-border-subtle);
      color: var(--tk-text);
      text-decoration: none;
    }
    .lr:first-child {
      border-top: 0;
    }
    .lr:hover {
      background: var(--tk-bg-hover);
    }
    .i {
      color: var(--tk-text-subtle);
    }
    .t {
      font-weight: var(--tk-weight-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .p {
      flex: 1;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .w {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class FolderContentView {
  protected readonly tree = inject(DocTreeStore);

  readonly doc = input.required<Doc>();

  protected readonly children = computed(() =>
    this.tree.status() === 'loaded'
      ? this.tree.children(this.doc().key).filter((c) => !isPendingKey(c.key))
      : (this.doc().children ?? []),
  );
  protected readonly url = docUrl;
  protected readonly icon = docIcon;

  protected create(kind: DocKind): void {
    this.tree.startCreate(kind, this.doc().key);
  }
}
