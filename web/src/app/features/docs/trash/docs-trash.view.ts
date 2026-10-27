import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { docsHomeUrl } from '@core/docs/doc-links';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { docIcon, DOCS_ICONS } from '../docs-icons';
import { DocTreeStore } from '../tree/doc-tree.store';
import { DocsTrashStore } from './docs-trash.store';

/// Docs trash (`docs.trash`): one row per delete group with its former path, who deleted it and
/// when, and Restore. Only Owners reach it; others get the not-found state (spec 1.5).
@Component({
  selector: 'tk-docs-trash-view',
  imports: [
    RouterLink,
    MatButtonModule,
    IconComponent,
    AvatarComponent,
    EmptyStateComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
  ],
  providers: [DocsTrashStore],
  viewProviders: [provideIcons(DOCS_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.trash' },
  template: `
    <div class="trash">
      <header class="head">
        <h1>Trash</h1>
        <span class="muted"
          >Deleted docs stay here. Restoring brings back everything deleted with it.</span
        >
      </header>
      @switch (store.status()) {
        @case ('loaded') {
          @if (store.items().length === 0) {
            <tk-empty-state
              icon="tablerTrash"
              title="Trash is empty"
              data-testid="docs-trash-empty"
            />
          } @else {
            <div class="lst" data-testid="docs-trash-list">
              @for (item of store.items(); track item.key) {
                <div class="lr" [attr.data-testid]="'docs-trash-row-' + item.key">
                  <tk-icon class="i" [name]="icon(item.kind, item.diagramFormat)" [size]="16" />
                  <span class="t">{{ item.title }}</span>
                  @if (item.count > 1) {
                    <span class="extra tnum">+{{ item.count - 1 }}</span>
                  }
                  <span class="p" [attr.title]="item.formerPath">{{ item.formerPath }}</span>
                  <tk-avatar
                    [userId]="item.deletedBy.id"
                    [name]="item.deletedBy.displayName"
                    [size]="20"
                  />
                  <span class="w">{{ item.deletedAt | relativeTime }}</span>
                  <button
                    mat-stroked-button
                    type="button"
                    class="restore"
                    [attr.data-testid]="'docs-trash-restore-' + item.key"
                    [disabled]="store.restoring().has(item.key)"
                    (click)="store.restore(item)"
                  >
                    <tk-icon name="tablerArrowBackUp" [size]="14" />
                    Restore
                  </button>
                </div>
              }
            </div>
            @if (store.nextCursor()) {
              <button
                mat-button
                type="button"
                class="more"
                [disabled]="store.loadingMore()"
                (click)="store.loadMore()"
              >
                Show more
              </button>
            }
          }
        }
        @case ('error') {
          @if (store.error()?.isNotFound || store.error()?.status === 403) {
            <tk-empty-state
              icon="tablerTrash"
              title="Only project owners can open the trash"
              data-testid="docs-trash-forbidden"
            >
              <a mat-stroked-button [routerLink]="homeUrl()">Back to Docs</a>
            </tk-empty-state>
          } @else {
            <tk-empty-state
              icon="tablerAlertCircle"
              tone="danger"
              title="Couldn't load the trash"
              [description]="store.error()?.title ?? null"
            >
              <button mat-stroked-button type="button" (click)="load()">Retry</button>
            </tk-empty-state>
          }
        }
        @default {
          <tk-skeleton-rows [count]="6" />
        }
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }
    .trash {
      max-width: 960px;
      margin: 0 auto;
      padding: 28px 48px 48px;
    }
    .head {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 20px;
    }
    h1 {
      margin: 0;
      font-size: var(--tk-text-xl);
      line-height: var(--tk-leading-xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
    }
    .muted {
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .lst {
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      overflow: hidden;
      background: var(--tk-surface);
    }
    .lr {
      height: 40px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 8px 0 12px;
      border-top: 1px solid var(--tk-border-subtle);
    }
    .lr:first-child {
      border-top: 0;
    }
    .i {
      color: var(--tk-text-subtle);
    }
    .t {
      font-weight: var(--tk-weight-medium);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 40%;
    }
    .extra {
      color: var(--tk-text-subtle);
      font-size: var(--tk-text-xs);
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
    .restore {
      gap: 6px;
    }
    .more {
      margin-top: 8px;
    }
  `,
})
export class DocsTrashView {
  protected readonly store = inject(DocsTrashStore);
  private readonly tree = inject(DocTreeStore);

  readonly projectKey = input.required<string>();

  protected readonly icon = docIcon;
  protected readonly homeUrl = () => docsHomeUrl(this.projectKey().toUpperCase());

  constructor() {
    effect(() => {
      this.projectKey();
      untracked(() => {
        this.tree.activeKey.set(null);
        this.load();
      });
    });
  }

  protected load(): void {
    void this.store.load(this.projectKey().toUpperCase());
  }
}
