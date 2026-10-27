import { NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  Type,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, NavigationEnd, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerDownload, tablerFileTypePdf, tablerHistory } from '@ng-icons/tabler-icons';
import { filter, map } from 'rxjs';
import { docsHomeUrl, docSlug, docUrl } from '@core/docs/doc-links';
import { Doc, DocKind } from '@core/docs/doc.models';
import { DocExports } from '@core/docs/doc-export';
import { DocsApi } from '@core/docs/docs.api';
import { RecentDocs } from '@core/docs/recent-docs';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { Breadcrumbs } from '@core/layout/breadcrumbs';
import { PageTitleStrategy } from '@core/layout/page-title';
import { ToastService } from '@core/notify/toast.service';
import { ViewDefinition } from '@core/views/view-definition';
import { ViewRegistry } from '@core/views/view-registry';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { DOCS_ICONS } from '../docs-icons';
import {
  DOC_CONTENT_VIEWS,
  DOCS_HISTORY_VIEW,
  DOCS_VERSION_VIEW,
  hasDocEditor,
} from '../docs.views';
import { DocTreeStore } from '../tree/doc-tree.store';
import { DocBarSlot } from './doc-bar-slot';
import { DocStore } from './doc.store';

/// Presence ("Jane is editing") and newer versions are picked up this often while a doc is open.
const PRESENCE_REFRESH_MS = 30_000;

/// One doc (`docs.doc`): loads it (cached per key), replaces a stale or missing slug, selects it in
/// the tree, sets the title and breadcrumbs, and renders the page bar plus the content view of its
/// kind (`docs.page`, `docs.diagram`, `docs.folder`) with the input `doc`. The bar holds the content
/// view's actions (`DocBarSlot`), Export PDF (`Mod+P`, the shown version), Download .md (pages) and Edit (`E`, `?mode=edit`; in edit mode the content view's editor bar replaces
/// it). The doc is refetched every 30 s for presence and newer versions.
@Component({
  selector: 'tk-doc-view',
  imports: [
    NgComponentOutlet,
    NgTemplateOutlet,
    RouterLink,
    MatButtonModule,
    IconComponent,
    AvatarComponent,
    EmptyStateComponent,
    KbdComponent,
    RelativeTimePipe,
  ],
  providers: [DocStore, DocBarSlot],
  viewProviders: [
    provideIcons({ ...DOCS_ICONS, tablerDownload, tablerFileTypePdf, tablerHistory }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    'data-testid': 'view-docs.doc',
    '[class.editing]': 'editing()',
    '[class.history]': 'historyOpen()',
  },
  template: `
    @if (viewDoc(); as doc) {
      @if (!editing() && !historyOpen()) {
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
              <tk-avatar
                [userId]="doc.updatedBy.id"
                [name]="doc.updatedBy.displayName"
                [size]="20"
              />
              <span class="who">{{ doc.updatedBy.displayName }}</span>
              <span>{{ doc.updatedAt | relativeTime }}</span>
              <span class="sep">·</span>
              <button
                type="button"
                class="badge tnum"
                title="Version history (H)"
                data-testid="doc-version"
                (click)="openHistory()"
              >
                v{{ doc.version }}
              </button>
            }
          </span>
          <div class="right">
            @if (barSlot.actions(); as actions) {
              <ng-container *ngTemplateOutlet="actions" />
            }
            <button
              type="button"
              class="tk-icon-btn"
              [title]="exportTitle"
              aria-label="Export PDF"
              data-testid="doc-export-pdf"
              [disabled]="exports.isExporting(doc.key, shownVersion())"
              [attr.aria-busy]="exports.isExporting(doc.key, shownVersion())"
              (click)="exportPdf(doc)"
            >
              <tk-icon name="tablerFileTypePdf" [size]="16" />
            </button>
            @if (doc.kind === 'Page') {
              <a
                class="tk-icon-btn"
                title="Download .md"
                aria-label="Download as markdown"
                data-testid="doc-download-md"
                download
                [href]="markdownUrl(doc)"
              >
                <tk-icon name="tablerDownload" [size]="16" />
              </a>
            }
            @if (doc.kind !== 'Folder') {
              <button
                type="button"
                class="tk-icon-btn"
                title="Version history (H)"
                aria-label="Version history"
                data-testid="doc-history"
                (click)="openHistory()"
              >
                <tk-icon name="tablerHistory" [size]="16" />
              </button>
            }
            <button
              type="button"
              class="tk-icon-btn"
              [title]="copyLinkTitle"
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
            @if (canEditContent()) {
              <button
                mat-stroked-button
                type="button"
                class="edit"
                data-testid="doc-edit"
                (click)="edit()"
              >
                <tk-icon name="tablerPencil" [size]="16" />Edit<tk-kbd>E</tk-kbd>
              </button>
            }
          </div>
        </div>
      }
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
  protected readonly barSlot = inject(DocBarSlot);
  private readonly router = inject(Router);
  private readonly registry = inject(ViewRegistry);
  private readonly breadcrumbs = inject(Breadcrumbs);
  private readonly pageTitle = inject(PageTitleStrategy);
  private readonly toast = inject(ToastService);
  private readonly route = inject(ActivatedRoute);
  private readonly api = inject(DocsApi);
  private readonly shortcuts = inject(ShortcutService);
  private readonly recentDocs = inject(RecentDocs);
  protected readonly exports = inject(DocExports);

  readonly projectKey = input.required<string>();
  readonly docKey = input.required<string>();
  readonly slug = input<string | undefined>(undefined);

  protected readonly lines = [96, 88, 62, 91, 74, 83, 58];
  protected readonly url = docUrl;
  protected readonly homeUrl = computed(() => docsHomeUrl(this.projectKey().toUpperCase()));
  protected readonly content = signal<Type<unknown> | null>(null);
  protected readonly copyLinkTitle = `Copy link (${this.shortcuts.format('mod+shift+.').join(' ')})`;
  protected readonly exportTitle = `Export PDF (${this.shortcuts.format('mod+p').join(' ')})`;

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
  private readonly query = toSignal(this.route.queryParamMap, {
    initialValue: this.route.snapshot.queryParamMap,
  });
  private readonly mode = computed(() => this.query().get('mode'));
  /// The older version shown (`?v=n`), which Export PDF exports; null for the latest.
  protected readonly shownVersion = computed(() => {
    const version = Number(this.query().get('v'));
    return this.store.doc()?.kind !== 'Folder' && Number.isInteger(version) && version > 0
      ? version
      : null;
  });
  private contentViewId: string | null = null;

  /// Docs with an editor (`hasDocEditor`) in a writable project can be edited (`E`, `?mode=edit`).
  protected readonly canEditContent = computed(() => {
    const doc = this.store.doc();
    return !!doc && hasDocEditor(doc) && doc.permissions.canEdit;
  });
  /// In edit mode the content view's editor bar replaces the page bar.
  protected readonly editing = computed(() => this.mode() === 'edit' && this.canEditContent());
  /// `?history=n`: the history view (with its own bar) replaces the page bar and the content.
  protected readonly historyOpen = computed(
    () => !this.editing() && this.query().has('history') && this.store.doc()?.kind !== 'Folder',
  );
  /// The content view: the history, one older version (`?v=n`) or the view of the doc's kind.
  private readonly contentView = computed<ViewDefinition | null>(() => {
    const kind: DocKind | undefined = this.store.doc()?.kind;
    if (!kind) return null;
    if (this.historyOpen()) return DOCS_HISTORY_VIEW;
    if (!this.editing() && kind !== 'Folder' && this.query().has('v')) return DOCS_VERSION_VIEW;
    return DOC_CONTENT_VIEWS[kind];
  });

  constructor() {
    this.shortcuts.registerScoped([
      {
        keys: 'e',
        description: 'Edit the doc',
        section: 'Docs',
        handler: () => {
          if (this.canEditContent() && !this.editing()) this.edit();
        },
      },
      {
        keys: 'h',
        description: 'Version history',
        section: 'Docs',
        handler: () => {
          if (this.historyOpen()) this.closeHistory();
          else if (!this.editing()) this.openHistory();
        },
      },
      {
        keys: 'mod+p',
        description: 'Export PDF',
        section: 'Docs',
        handler: () => {
          const doc = this.viewDoc();
          if (doc && !this.editing()) this.exportPdf(doc);
        },
      },
      {
        keys: 'mod+.',
        description: 'Copy the doc key',
        section: 'Docs',
        handler: () => {
          const doc = this.viewDoc();
          if (doc) this.copyKey(doc);
        },
      },
      {
        keys: 'mod+shift+.',
        description: 'Copy the doc link',
        section: 'Docs',
        handler: () => {
          const doc = this.viewDoc();
          if (doc) this.copyLink(doc);
        },
      },
    ]);

    const presence = setInterval(() => {
      if (document.visibilityState === 'visible' && this.store.doc()?.kind !== 'Folder')
        void this.store.refresh();
    }, PRESENCE_REFRESH_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(presence));

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
          void this.router.navigateByUrl(
            this.router.createUrlTree([docUrl(doc.key, doc.title)], {
              queryParamsHandling: 'preserve',
              preserveFragment: true,
            }),
            { replaceUrl: true },
          );
      });
    });

    effect(() => {
      const doc = this.viewDoc();
      this.navigations();
      if (!doc) return;
      untracked(() => {
        this.pageTitle.setSubject(doc.title);
        this.recentDocs.visited(doc);
        this.breadcrumbs.setTail([
          ...doc.breadcrumb.map((c) => ({ label: c.title, url: docUrl(c.key, c.title) })),
          { label: doc.title, url: null },
        ]);
      });
    });

    effect(() => {
      const definition = this.contentView();
      if (!definition || definition.viewId === this.contentViewId) return;
      this.contentViewId = definition.viewId;
      untracked(() => {
        this.content.set(null);
        void this.registry.resolve(definition).then((component) => {
          if (this.contentViewId !== definition.viewId) return;
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

  protected edit(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'edit' },
      queryParamsHandling: 'merge',
    });
  }

  protected openHistory(): void {
    const doc = this.store.doc();
    if (!doc || doc.kind === 'Folder') return;
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { history: this.query().get('v') ?? doc.version, v: null },
      queryParamsHandling: 'merge',
    });
  }

  private closeHistory(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { history: null, with: null },
      queryParamsHandling: 'merge',
    });
  }

  protected exportPdf(doc: Doc): void {
    void this.exports.export({
      key: doc.key,
      title: doc.title,
      kind: doc.kind,
      version: this.shownVersion(),
    });
  }

  protected markdownUrl(doc: Doc): string {
    return this.api.markdownExportUrl(doc.key);
  }

  private copyKey(doc: Doc): void {
    void navigator.clipboard
      .writeText(doc.key)
      .then(() => this.toast.success(`${doc.key} copied`))
      .catch(() => this.toast.error("Couldn't copy the key"));
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
