import { NgComponentOutlet } from '@angular/common';
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
  Type,
  untracked,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { map } from 'rxjs';
import { Doc } from '@core/docs/doc.models';
import { ViewRegistry } from '@core/views/view-registry';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { DocDraftBannerComponent } from '../doc/doc-draft-banner.component';
import { DOCS_PAGE_EDIT_VIEW } from '../docs.views';
import { DocMarkdownComponent } from './doc-markdown.component';
import { DocPageSectionsComponent } from './doc-page-sections.component';
import { DocPresenceComponent } from './doc-presence.component';
import { activeHeading, extractOutline, OutlineEntry } from './page-outline';

/// A page (`docs.page`): the reader with its meta line, the "unpublished changes" banner, the
/// rendered markdown, "On this page" with scroll spy and the registered page sections; with
/// `?mode=edit` (writers) it renders the lazily loaded editor (`docs.page.edit`) instead.
@Component({
  selector: 'tk-doc-page-view',
  imports: [
    NgComponentOutlet,
    MatButtonModule,
    KbdComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
    DocDraftBannerComponent,
    DocMarkdownComponent,
    DocPageSectionsComponent,
    DocPresenceComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'view-docs.page', '[class.editing]': 'editing()' },
  templateUrl: './page.view.html',
  styleUrl: './page.view.scss',
})
export class PageView {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly registry = inject(ViewRegistry);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;

  readonly doc = input.required<Doc>();

  private readonly mode = toSignal(this.route.queryParamMap.pipe(map((q) => q.get('mode'))), {
    initialValue: null,
  });
  protected readonly editing = computed(
    () => this.mode() === 'edit' && this.doc().permissions.canEdit,
  );
  protected readonly editor = signal<Type<unknown> | null>(null);
  protected readonly outline = signal<readonly OutlineEntry[]>([]);
  protected readonly activeId = signal<string | null>(null);
  protected readonly lines = [96, 88, 62, 91, 74, 83, 58];

  private scroller: HTMLElement | null = null;
  private scrolledToHash = false;
  private spyFrame = 0;

  constructor() {
    effect(() => {
      if (!this.editing() || this.editor()) return;
      untracked(() => {
        void this.registry.resolve(DOCS_PAGE_EDIT_VIEW).then((component) => {
          this.editor.set(component);
          this.registry.reportExposure(DOCS_PAGE_EDIT_VIEW.viewId);
        });
      });
    });

    const onScroll = () => {
      if (this.spyFrame) return;
      this.spyFrame = requestAnimationFrame(() => {
        this.spyFrame = 0;
        this.spy();
      });
    };
    effect((onCleanup) => {
      if (this.editing()) return;
      const scroller = scrollParent(this.host);
      this.scroller = scroller;
      scroller?.addEventListener('scroll', onScroll, { passive: true });
      onCleanup(() => scroller?.removeEventListener('scroll', onScroll));
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.spyFrame));
  }

  protected onRendered(root: HTMLElement): void {
    this.outline.set(extractOutline(root));
    this.spy();
    if (this.scrolledToHash || !location.hash) return;
    this.scrolledToHash = true;
    const target = root.querySelector(
      `[id="${CSS.escape(decodeURIComponent(location.hash.slice(1)))}"]`,
    );
    target?.scrollIntoView();
  }

  protected goTo(event: MouseEvent, entry: OutlineEntry): void {
    event.preventDefault();
    const heading = this.host.querySelector(`[id="${CSS.escape(entry.id)}"]`);
    if (!heading) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${entry.id}`);
    this.activeId.set(entry.id);
  }

  protected edit(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'edit' },
      queryParamsHandling: 'merge',
    });
  }

  private spy(): void {
    const scroller = this.scroller;
    const entries = this.outline();
    if (!scroller || entries.length === 0) return;
    const top = scroller.getBoundingClientRect().top;
    const positions = entries.map((entry) => ({
      id: entry.id,
      top:
        this.host.querySelector(`[id="${CSS.escape(entry.id)}"]`)?.getBoundingClientRect().top ?? 0,
    }));
    this.activeId.set(activeHeading(positions, top));
  }
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}
