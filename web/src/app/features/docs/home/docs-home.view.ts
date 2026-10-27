import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { docPathSegments, docUrl } from '@core/docs/doc-links';
import { DocKind } from '@core/docs/doc.models';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';
import { DocTreeStore } from '../tree/doc-tree.store';
import { DocsHomeStore } from './docs-home.store';

/// Docs home (`docs.home`, spec 1.15 and 1.17): page count, quick actions, "Recently updated",
/// and the empty state for a project without docs. Viewers and archived projects get no actions.
@Component({
  selector: 'tk-docs-home-view',
  imports: [
    RouterLink,
    MatButtonModule,
    IconComponent,
    KbdComponent,
    AvatarComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
  ],
  providers: [DocsHomeStore],
  viewProviders: [provideIcons(DOCS_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.home' },
  template: `
    @if (tree.isEmpty()) {
      <tk-empty-state
        icon="tablerBook"
        title="No docs yet"
        description="Pages, folders and diagrams for this project live here."
        data-testid="docs-empty"
      >
        @if (tree.canWrite()) {
          <button
            mat-flat-button
            type="button"
            data-testid="docs-empty-new-page"
            (click)="create('Page')"
          >
            New page <tk-kbd tone="on-solid">N</tk-kbd>
          </button>
          <button mat-stroked-button type="button" (click)="create('Folder')">New folder</button>
          <button mat-stroked-button type="button" (click)="create('Diagram')">New diagram</button>
        }
      </tk-empty-state>
    } @else {
      <div class="home">
        <header class="home-h">
          <h1>Docs</h1>
          @if (tree.status() === 'loaded') {
            <span class="count tnum" data-testid="docs-count">{{ countLabel() }}</span>
          }
          @if (tree.canWrite()) {
            <div class="right">
              <button mat-stroked-button type="button" (click)="create('Folder')">
                <tk-icon name="tablerFolderPlus" [size]="14" />
                New folder
              </button>
              <button mat-stroked-button type="button" (click)="create('Diagram')">
                <tk-icon name="tablerSitemap" [size]="14" />
                New diagram
              </button>
              <button
                mat-flat-button
                type="button"
                data-testid="docs-new-page"
                (click)="create('Page')"
              >
                <tk-icon name="tablerPlus" [size]="14" />
                New page <tk-kbd tone="on-solid">N</tk-kbd>
              </button>
            </div>
          }
        </header>

        <h2 class="sech">Recently updated</h2>
        @switch (store.status()) {
          @case ('loaded') {
            @if (store.recent().length === 0) {
              <p class="none" data-testid="docs-recent-none">
                Nothing yet. Pages and diagrams show up here when they are written.
              </p>
            } @else {
              <div class="lst" data-testid="docs-recent">
                @for (doc of store.recent(); track doc.key) {
                  <a
                    class="lr"
                    [routerLink]="url(doc.key, doc.title)"
                    [attr.data-testid]="'docs-recent-' + doc.key"
                  >
                    <tk-icon class="i" [name]="icon(doc.kind, doc.diagramFormat)" [size]="16" />
                    <span class="t">{{ doc.title }}</span>
                    <span class="p">{{ folderOf(doc.path) }}</span>
                    <tk-avatar
                      [userId]="doc.updatedBy.id"
                      [name]="doc.updatedBy.displayName"
                      [size]="20"
                    />
                    <span class="w">{{ doc.updatedAt | relativeTime }}</span>
                  </a>
                }
              </div>
            }
          }
          @case ('error') {
            <p class="none danger">Couldn't load recent docs: {{ store.error() }}</p>
          }
          @default {
            <tk-skeleton-rows [count]="5" />
          }
        }
      </div>
    }
  `,
  styles: `
    :host {
      display: block;
    }
    .home {
      max-width: 808px;
      margin: 0 auto;
      padding: 28px 48px 48px;
    }
    .home-h {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 24px;
    }
    h1 {
      margin: 0;
      font-size: var(--tk-text-xl);
      line-height: var(--tk-leading-xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
    }
    .count {
      color: var(--tk-text-muted);
    }
    .right {
      margin-left: auto;
      display: flex;
      gap: 8px;
    }
    .right button {
      gap: 6px;
    }
    .sech {
      margin: 0 0 6px;
      font-size: var(--tk-text-xs);
      font-weight: var(--tk-weight-medium);
      letter-spacing: var(--tk-tracking-caps);
      text-transform: uppercase;
      color: var(--tk-text-subtle);
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
      max-width: 50%;
    }
    .p {
      flex: 1;
      min-width: 0;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .w {
      width: 72px;
      text-align: right;
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-sm);
    }
    .none {
      margin: 0;
      color: var(--tk-text-muted);
    }
    .danger {
      color: var(--tk-danger-fg);
    }
  `,
})
export class DocsHomeView {
  protected readonly tree = inject(DocTreeStore);
  protected readonly store = inject(DocsHomeStore);

  readonly projectKey = input.required<string>();

  protected readonly countLabel = computed(() => {
    const count = this.tree.documentCount();
    return `${count} ${count === 1 ? 'doc' : 'docs'}`;
  });
  protected readonly url = docUrl;
  protected readonly icon = docIcon;

  constructor() {
    effect(() => {
      const key = this.projectKey().toUpperCase();
      untracked(() => {
        this.tree.activeKey.set(null);
        void this.store.load(key);
      });
    });
  }

  protected create(kind: DocKind): void {
    this.tree.startCreate(kind, null);
  }

  /// The folder part of a doc path ("Architecture/ADRs/Use Postgres" → "Architecture / ADRs").
  protected folderOf(path: string): string {
    const segments = docPathSegments(path);
    return segments.length > 1 ? segments.slice(0, -1).join(' / ') : 'Top level';
  }
}
