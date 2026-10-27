import { NgComponentOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  Type,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { filter, map } from 'rxjs';
import { docsHomeUrl, docSlug, docUrl } from '@core/docs/doc-links';
import { Doc, DocKind } from '@core/docs/doc.models';
import { Breadcrumbs } from '@core/layout/breadcrumbs';
import { PageTitleStrategy } from '@core/layout/page-title';
import { ToastService } from '@core/notify/toast.service';
import { ViewRegistry } from '@core/views/view-registry';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DOCS_ICONS } from '../docs-icons';
import { DOC_CONTENT_VIEWS } from '../docs.views';
import { DocTreeStore } from '../tree/doc-tree.store';
import { DocStore } from './doc.store';

/// One doc (`docs.doc`): loads it (cached per key), replaces a stale or missing slug, selects it in
/// the tree, sets the title and breadcrumbs, and renders the page bar plus the content view of its
/// kind (`docs.page`, `docs.diagram`, `docs.folder`) with the input `doc`.
@Component({
  selector: 'tk-doc-view',
  imports: [
    NgComponentOutlet,
    RouterLink,
    MatButtonModule,
    IconComponent,
    AvatarComponent,
    EmptyStateComponent,
    RelativeTimePipe,
  ],
  providers: [DocStore],
  viewProviders: [provideIcons(DOCS_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.doc' },
  template: `
    @if (viewDoc(); as doc) {
      <div class="pbar" data-testid="doc-bar">
        <span class="meta">
          <tk-icon
            class="i"
            [name]="doc.breadcrumb.length ? 'tablerFolder' : 'tablerBook'"
            [size]="16"
          />
          @for (crumb of doc.breadcrumb; track crumb.key; let last = $last) {
            <a class="crumb" [routerLink]="url(crumb.key, crumb.title)">{{ crumb.title }}</a>
            @if (!last) {
              <span class="sep">/</span>
            }
          } @empty {
            <a class="crumb" [routerLink]="homeUrl()">Docs</a>
          }
          @if (doc.kind !== 'Folder') {
            <span class="sep">·</span>
            <span class="edited">Edited by</span>
            <tk-avatar [userId]="doc.updatedBy.id" [name]="doc.updatedBy.displayName" [size]="20" />
            <span class="who">{{ doc.updatedBy.displayName }}</span>
            <span>{{ doc.updatedAt | relativeTime }}</span>
            <span class="sep">·</span>
            <span class="badge tnum" data-testid="doc-version">v{{ doc.version }}</span>
          }
        </span>
        <div class="right">
          <button
            type="button"
            class="tk-icon-btn"
            title="Copy link"
            aria-label="Copy link"
            data-testid="doc-copy-link"
            (click)="copyLink(doc)"
          >
            <tk-icon name="tablerLink" [size]="16" />
          </button>
          <button
            type="button"
            class="tk-icon-btn"
            title="More"
            aria-label="More actions"
            data-testid="doc-bar-more"
            (click)="openMenu($event, doc)"
          >
            <tk-icon name="tablerDots" [size]="16" />
          </button>
        </div>
      </div>
      @if (content(); as component) {
        <ng-container *ngComponentOutlet="component; inputs: { doc }" />
      }
    } @else if (store.status() === 'error') {
      @if (store.error()?.isNotFound) {
        <tk-empty-state
          icon="tablerFileText"
          title="This doc was deleted or moved"
          description="It may be in the trash, or you may not have access to it."
          data-testid="doc-not-found"
        >
          @if (tree.canManageTrash()) {
            <a mat-stroked-button [routerLink]="homeUrl() + '/trash'">Open Trash</a>
          }
          <a mat-stroked-button [routerLink]="homeUrl()">Back to Docs</a>
        </tk-empty-state>
      } @else {
        <tk-empty-state
          icon="tablerAlertCircle"
          tone="danger"
          title="Couldn't load this doc"
          [description]="store.error()?.title ?? null"
          data-testid="doc-load-error"
        >
          <button mat-stroked-button type="button" (click)="store.reload()">Retry</button>
        </tk-empty-state>
      }
    } @else {
      <div class="skeleton" role="status" aria-label="Loading" data-testid="doc-skeleton">
        <div class="pbar"><span class="sk" style="width: 260px"></span></div>
        <div class="sk-body">
          <span class="sk sk-title"></span>
          <span class="sk sk-meta"></span>
          @for (width of lines; track $index) {
            <span class="sk sk-line" [style.width.%]="width"></span>
          }
        </div>
      </div>
    }
  `,
  styleUrl: './doc.view.scss',
})
export class DocView {
  protected readonly store = inject(DocStore);
  protected readonly tree = inject(DocTreeStore);
  private readonly router = inject(Router);
  private readonly registry = inject(ViewRegistry);
  private readonly breadcrumbs = inject(Breadcrumbs);
  private readonly pageTitle = inject(PageTitleStrategy);
  private readonly toast = inject(ToastService);

  readonly projectKey = input.required<string>();
  readonly docKey = input.required<string>();
  readonly slug = input<string | undefined>(undefined);

  protected readonly lines = [96, 88, 62, 91, 74, 83, 58];
  protected readonly url = docUrl;
  protected readonly homeUrl = computed(() => docsHomeUrl(this.projectKey().toUpperCase()));
  protected readonly content = signal<Type<unknown> | null>(null);

  /// The loaded doc with the tree's title, so a rename in the tree shows at once.
  protected readonly viewDoc = computed<Doc | null>(() => {
    const doc = this.store.doc();
    if (!doc) return null;
    const title = this.tree.item(doc.key)?.title;
    return title && title !== doc.title ? { ...doc, title } : doc;
  });

  private readonly navigations = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map((_, i) => i),
    ),
    { initialValue: -1 },
  );
  private contentKind: DocKind | null = null;

  constructor() {
    effect(() => {
      const key = this.docKey().toUpperCase();
      untracked(() => {
        this.tree.activeKey.set(key);
        void this.store.load(key);
      });
    });

    effect(() => {
      const doc = this.viewDoc();
      const ready = this.tree.status() === 'loaded';
      if (!doc || !ready) return;
      untracked(() => {
        if (this.tree.cursorKey() !== doc.key && !this.tree.renamingKey())
          this.tree.reveal(doc.key);
      });
    });

    effect(() => {
      const doc = this.viewDoc();
      if (!doc) return;
      const slug = this.slug();
      const routeKey = this.docKey();
      const routeProject = this.projectKey();
      untracked(() => {
        if (
          slug !== docSlug(doc.title) ||
          routeKey !== doc.key ||
          routeProject.toUpperCase() !== doc.projectKey
        )
          void this.router.navigateByUrl(docUrl(doc.key, doc.title), { replaceUrl: true });
      });
    });

    effect(() => {
      const doc = this.viewDoc();
      this.navigations();
      if (!doc) return;
      untracked(() => {
        this.pageTitle.setSubject(doc.title);
        this.breadcrumbs.setTail([
          ...doc.breadcrumb.map((c) => ({ label: c.title, url: docUrl(c.key, c.title) })),
          { label: doc.title, url: null },
        ]);
      });
    });

    effect(() => {
      const kind = this.store.doc()?.kind ?? null;
      if (!kind || kind === this.contentKind) return;
      this.contentKind = kind;
      const definition = DOC_CONTENT_VIEWS[kind];
      untracked(() => {
        this.content.set(null);
        void this.registry.resolve(definition).then((component) => {
          if (this.contentKind !== kind) return;
          this.content.set(component);
          this.registry.reportExposure(definition.viewId);
        });
      });
    });

    effect(() => {
      const doc = this.store.doc();
      if (doc) untracked(() => this.tree.patchFromDoc(doc));
    });

    effect(() => {
      if (this.tree.structureVersion() > 0) untracked(() => void this.store.refresh());
    });
  }

  protected copyLink(doc: Doc): void {
    void navigator.clipboard
      .writeText(`${location.origin}${docUrl(doc.key, doc.title)}`)
      .then(() => this.toast.success(`Link to ${doc.key} copied`))
      .catch(() => this.toast.error("Couldn't copy the link"));
  }

  protected openMenu(event: MouseEvent, doc: Doc): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.tree.menuRequest.set({ key: doc.key, x: rect.left - 160, y: rect.bottom });
  }
}
