import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { provideIcons } from '@ng-icons/core';
import { tablerCode, tablerPlus } from '@ng-icons/tabler-icons';
import { firstValueFrom } from 'rxjs';
import { SwrCache } from '@core/api/swr-cache';
import { toApiError } from '@core/api/api-error';
import { DiagramFormat, DocTreeItem } from '@core/docs/doc.models';
import { DocsApi } from '@core/docs/docs.api';
import { ToastService } from '@core/notify/toast.service';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';
import { DocTreeStore, docsTreeTag } from '../tree/doc-tree.store';

export interface InsertDiagramData {
  projectKey: string;
  /// The page being edited: new diagrams go into its folder.
  docKey: string;
}

/// What to insert: an embed of a diagram doc, or an inline ```mermaid block.
export type InsertDiagramResult =
  { kind: 'embed'; key: string; title: string } | { kind: 'inline' };

const MAX_SHOWN = 50;

/// "Insert diagram" of the page editor (spec 1.8): pick a diagram of the project to embed
/// (`![Title](KEY)`), create a new Mermaid diagram or Canvas drawing next to the page and embed it,
/// or insert an inline Mermaid block. Enter in the search picks the first match (or creates one).
@Component({
  selector: 'tk-insert-diagram-dialog',
  imports: [MatButtonModule, MatDialogModule, IconComponent],
  viewProviders: [provideIcons({ ...DOCS_ICONS, tablerCode, tablerPlus })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'insert-diagram-dialog' },
  template: `
    <h2 mat-dialog-title>Insert diagram</h2>
    <mat-dialog-content>
      <label class="search">
        <tk-icon name="tablerSearch" [size]="14" />
        <input
          type="search"
          placeholder="Find a diagram, or type a title for a new one"
          aria-label="Find or name a diagram"
          data-testid="insert-diagram-search"
          [value]="text()"
          (input)="text.set($any($event.target).value)"
          (keydown.enter)="pickFirst($event)"
        />
      </label>
      <div class="list" role="list" aria-label="Diagrams">
        @for (item of matches(); track item.key) {
          <button
            type="button"
            role="listitem"
            class="row"
            [attr.data-testid]="'insert-diagram-row-' + item.key"
            (click)="embed(item)"
          >
            <tk-icon [name]="icon(item)" [size]="16" />
            <span class="title">{{ item.title }}</span>
            <span class="key tnum">{{ item.key }}</span>
          </button>
        } @empty {
          <div class="note">
            {{ text() ? 'No diagram matches.' : 'This project has no diagrams yet.' }}
          </div>
        }
      </div>
      <div class="new">
        <button
          type="button"
          class="row"
          data-testid="insert-diagram-create"
          [disabled]="busy()"
          (click)="create()"
        >
          <tk-icon name="tablerPlus" [size]="16" />
          <span class="title">New Mermaid diagram "{{ newTitle() }}"</span>
          <span class="hint">embedded, next to this page</span>
        </button>
        <button
          type="button"
          class="row"
          data-testid="insert-diagram-create-canvas"
          [disabled]="busy()"
          (click)="create('Canvas')"
        >
          <tk-icon name="tablerChalkboard" [size]="16" />
          <span class="title">New Canvas drawing "{{ newTitle() }}"</span>
          <span class="hint">draw it after publishing</span>
        </button>
        <button type="button" class="row" data-testid="insert-diagram-inline" (click)="inline()">
          <tk-icon name="tablerCode" [size]="16" />
          <span class="title">Inline Mermaid block</span>
          <span class="hint">part of this page</span>
        </button>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button type="button" mat-dialog-close>Cancel</button>
    </mat-dialog-actions>
  `,
  styles: `
    .search {
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      color: var(--tk-text-subtle);
      background: var(--tk-surface);
    }
    .search:focus-within {
      border-color: var(--tk-accent);
    }
    .search input {
      flex: 1;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
    }
    .list {
      margin-top: 8px;
      height: 240px;
      overflow: auto;
      border: 1px solid var(--tk-border-subtle);
      border-radius: var(--tk-radius-md);
    }
    .new {
      margin-top: 8px;
      border: 1px solid var(--tk-border-subtle);
      border-radius: var(--tk-radius-md);
      overflow: hidden;
    }
    .row {
      width: 100%;
      height: 32px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 10px;
      border: 0;
      border-bottom: 1px solid var(--tk-border-subtle);
      background: none;
      color: var(--tk-text);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .row:last-child {
      border-bottom: 0;
    }
    .row:hover,
    .row:focus-visible {
      background: var(--tk-bg-hover);
    }
    .row tk-icon {
      color: var(--tk-text-subtle);
    }
    .title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .key,
    .hint {
      flex: none;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .note {
      padding: 12px;
      color: var(--tk-text-subtle);
    }
  `,
})
export class InsertDiagramDialog {
  private readonly data = inject<InsertDiagramData>(MAT_DIALOG_DATA);
  private readonly ref =
    inject<MatDialogRef<InsertDiagramDialog, InsertDiagramResult>>(MatDialogRef);
  private readonly tree = inject(DocTreeStore);
  private readonly api = inject(DocsApi);
  private readonly cache = inject(SwrCache);
  private readonly toast = inject(ToastService);

  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly newTitle = computed(() => this.text().trim() || 'Untitled diagram');
  protected readonly matches = computed(() => {
    const query = this.text().trim().toLowerCase();
    return this.tree
      .items()
      .filter((item) => item.kind === 'Diagram' && item.title.toLowerCase().includes(query))
      .slice(0, MAX_SHOWN);
  });

  protected icon(item: DocTreeItem): string {
    return docIcon(item.kind, item.diagramFormat);
  }

  protected embed(item: DocTreeItem): void {
    this.ref.close({ kind: 'embed', key: item.key, title: item.title });
  }

  protected inline(): void {
    this.ref.close({ kind: 'inline' });
  }

  protected pickFirst(event: Event): void {
    event.preventDefault();
    const first = this.matches()[0];
    if (first) this.embed(first);
    else void this.create();
  }

  protected async create(format: DiagramFormat = 'Mermaid'): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const doc = await firstValueFrom(
        this.api.create(
          this.data.projectKey,
          {
            kind: 'Diagram',
            diagramFormat: format,
            title: this.newTitle(),
            parent: this.tree.item(this.data.docKey)?.parentKey ?? 'root',
          },
          crypto.randomUUID(),
        ),
      );
      this.cache.invalidate(docsTreeTag(this.data.projectKey));
      void this.tree.reload();
      this.ref.close({ kind: 'embed', key: doc.key, title: doc.title });
    } catch (error) {
      this.busy.set(false);
      this.toast.error(`Couldn't create the diagram: ${toApiError(error).title}`);
    }
  }
}
