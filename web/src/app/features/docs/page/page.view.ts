import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import { DOCUMENT, NgComponentOutlet, NgTemplateOutlet } from '@angular/common';
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
  Signal,
  TemplateRef,
  Type,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { ActivatedRoute, Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerLayoutSidebarRightCollapse, tablerListDetails } from '@ng-icons/tabler-icons';
import { map } from 'rxjs';
import { DOC_PAGE_SECTIONS } from '@core/docs/doc-extensions';
import { mentionedTicketKey } from '@core/docs/doc-links';
import { Doc } from '@core/docs/doc.models';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ViewRegistry } from '@core/views/view-registry';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { DocBarSlot } from '../doc/doc-bar-slot';
import { DocDraftBannerComponent } from '../doc/doc-draft-banner.component';
import { DOCS_PAGE_EDIT_VIEW } from '../docs.views';
import { DocMarkdownComponent } from './doc-markdown.component';
import { DocPageSectionsComponent } from './doc-page-sections.component';
import { DocPresenceComponent } from './doc-presence.component';
import { activeHeading, extractOutline, OutlineEntry } from './page-outline';

const WIDE_QUERY = '(min-width: 1440px)';
const RAIL_KEYS = ']';
const RAIL_HIDDEN_KEY = 'tk-docs-rail-hidden';

/// A page (`docs.page`): the reader with its meta line, the "unpublished changes" banner, the
/// rendered markdown, "On this page" with scroll spy and the registered rail sections (a rail from
/// 1440 px that `]` hides, else a popover button in the page bar) and the footer sections; with
/// `?mode=edit` (writers) it renders the lazily loaded editor (`docs.page.edit`) instead.
@Component({
  selector: 'tk-doc-page-view',
  imports: [
    NgComponentOutlet,
    NgTemplateOutlet,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    MatButtonModule,
    IconComponent,
    KbdComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
    DocDraftBannerComponent,
    DocMarkdownComponent,
    DocPageSectionsComponent,
    DocPresenceComponent,
  ],
  viewProviders: [provideIcons({ tablerLayoutSidebarRightCollapse, tablerListDetails })],
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

  private readonly storage = inject(DOCUMENT).defaultView?.localStorage;
  private readonly shortcuts = inject(ShortcutService);
  private readonly barSlot = inject(DocBarSlot, { optional: true });
  private readonly barActions = viewChild<TemplateRef<unknown>>('barActions');
  private readonly popover = viewChild<ElementRef<HTMLElement>>('popover');
  private readonly railSections = inject(DOC_PAGE_SECTIONS).filter((s) => s.placement === 'rail');
  private readonly wide = mediaSignal(WIDE_QUERY);
  private readonly railHidden = signal(this.readRailHidden());

  /// The rail shows from 1440 px unless `]` hid it; otherwise "On this page" is a popover in the
  /// page bar.
  protected readonly railShown = computed(() => this.wide() && !this.railHidden());
  protected readonly hasRail = computed(() => {
    const kind = this.doc().kind;
    return (
      this.outline().length > 1 || this.railSections.some((s) => !s.kinds || s.kinds.includes(kind))
    );
  });
  protected readonly outlineOpen = signal(false);
  protected readonly railKeys = this.shortcuts.format(RAIL_KEYS).join(' ');
  protected readonly popoverPositions: ConnectedPosition[] = [
    { originX: 'end', originY: 'bottom', overlayX: 'end', overlayY: 'top', offsetY: 4 },
    { originX: 'end', originY: 'top', overlayX: 'end', overlayY: 'bottom', offsetY: -4 },
  ];

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

    effect((onCleanup) => {
      const template = this.barActions();
      const slot = this.barSlot;
      if (!template || !slot || this.editing()) return;
      onCleanup(untracked(() => slot.set(template)));
    });
    effect(() => {
      if (this.railShown() || !this.hasRail()) untracked(() => this.outlineOpen.set(false));
    });

    this.shortcuts.registerScoped([
      {
        keys: RAIL_KEYS,
        section: 'Docs',
        description: 'Show or hide "On this page"',
        handler: () => {
          if (this.editing() || !this.hasRail()) return;
          if (this.wide()) this.toggleRail();
          else this.outlineOpen.update((open) => !open);
        },
      },
    ]);
  }

  protected toggleRail(): void {
    this.railHidden.update((hidden) => !hidden);
    try {
      this.storage?.setItem(RAIL_HIDDEN_KEY, String(this.railHidden()));
    } catch {
      return;
    }
  }

  protected focusPopover(): void {
    const popover = this.popover()?.nativeElement;
    (popover?.querySelector<HTMLElement>('a.on, a') ?? popover)?.focus();
  }

  protected onPopoverKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    this.outlineOpen.set(false);
  }

  protected onRendered(root: HTMLElement): void {
    this.outline.set(extractOutline(root));
    this.spy();
    if (this.scrolledToHash || !location.hash) return;
    this.scrolledToHash = true;
    const fragment = decodeURIComponent(location.hash.slice(1));
    const ticketKey = mentionedTicketKey(fragment);
    const mention = ticketKey
      ? root.querySelector<HTMLElement>(`a.tk-tref[data-ticket-key="${CSS.escape(ticketKey)}"]`)
      : null;
    if (mention) {
      mention.scrollIntoView({ block: 'center' });
      mention.classList.add('tk-flash');
      mention.addEventListener('animationend', () => mention.classList.remove('tk-flash'), {
        once: true,
      });
      return;
    }
    root.querySelector(`[id="${CSS.escape(fragment)}"]`)?.scrollIntoView();
  }

  protected goTo(event: MouseEvent, entry: OutlineEntry): void {
    event.preventDefault();
    const heading = this.host.querySelector(`[id="${CSS.escape(entry.id)}"]`);
    if (!heading) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    heading.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(history.state, '', `${location.pathname}${location.search}#${entry.id}`);
    this.activeId.set(entry.id);
    this.outlineOpen.set(false);
  }

  protected goToComments(event: MouseEvent): void {
    event.preventDefault();
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.host.querySelector('#comments')?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth' });
    history.replaceState(history.state, '', `${location.pathname}${location.search}#comments`);
  }

  protected edit(): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { mode: 'edit' },
      queryParamsHandling: 'merge',
    });
  }

  private readRailHidden(): boolean {
    try {
      return this.storage?.getItem(RAIL_HIDDEN_KEY) === 'true';
    } catch {
      return false;
    }
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

function mediaSignal(query: string): Signal<boolean> {
  const media = inject(DOCUMENT).defaultView?.matchMedia?.(query);
  const matches = signal(media?.matches ?? false);
  if (media) {
    const update = (event: MediaQueryListEvent) => matches.set(event.matches);
    media.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => media.removeEventListener('change', update));
  }
  return matches.asReadonly();
}

function scrollParent(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === 'auto' || overflow === 'scroll') return node;
  }
  return null;
}
