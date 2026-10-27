import {
  CdkFixedSizeVirtualScroll,
  CdkVirtualForOf,
  CdkVirtualScrollViewport,
} from '@angular/cdk/scrolling';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Params, Router } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import {
  tablerDownload,
  tablerEye,
  tablerSortAscending,
  tablerSortDescending,
} from '@ng-icons/tabler-icons';
import { PEEK_QUERY_PARAM, PeekService } from '@core/layout/peek/peek';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { ThemeService } from '@core/theme/theme.service';
import { TicketCache } from '@core/tickets/ticket-cache';
import { TicketSummary, UserRef } from '@core/tickets/ticket.models';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { TicketRowComponent } from '@shared/ui/ticket-row/ticket-row.component';
import { SearchFilterBarComponent } from './search-filter-bar.component';
import {
  effectiveOrder,
  EMPTY_SEARCH,
  hasFilters,
  parseSearchParams,
  SearchFilters,
  SearchSort,
  sameFilters,
  SORTS,
  toSearchParams,
} from './search-query';
import { SearchStore } from './search.store';

const TEXT_DEBOUNCE_MS = 250;
const PREFETCH_DELAY_MS = 150;

/// Ticket search (spec 6.8, I-03, I-21): every filter, the text and the sort live in the URL, so a
/// search is shared or saved by copying the address. Results are a dense virtual list; `J`/`K` move,
/// `Enter` peeks, `Shift+Enter` opens the ticket, `/` focuses the text box.
@Component({
  selector: 'tk-search-view',
  imports: [
    CdkVirtualScrollViewport,
    CdkFixedSizeVirtualScroll,
    CdkVirtualForOf,
    MatButtonModule,
    MatMenuModule,
    MatTooltip,
    EmptyStateComponent,
    IconComponent,
    KbdComponent,
    SkeletonRowsComponent,
    TicketRowComponent,
    SearchFilterBarComponent,
  ],
  providers: [SearchStore],
  viewProviders: [
    provideIcons({ tablerDownload, tablerEye, tablerSortAscending, tablerSortDescending }),
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-search.results' },
  templateUrl: './search.view.html',
  styleUrl: './search.view.scss',
})
export class SearchView {
  protected readonly store = inject(SearchStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly peek = inject(PeekService);
  private readonly cache = inject(TicketCache);
  private readonly theme = inject(ThemeService);

  protected readonly sorts = SORTS;
  protected readonly rowHeight = computed(() => (this.theme.density() === 'compact' ? 28 : 32));
  protected readonly listHeight = signal(480);
  protected readonly text = signal('');
  protected readonly filtered = computed(() => hasFilters(this.store.filters()));
  protected readonly order = computed(() => effectiveOrder(this.store.filters()));
  protected readonly sortLabel = computed(
    () => SORTS.find((s) => s.value === this.store.filters().sort)?.label ?? 'Updated',
  );
  protected readonly countLabel = computed(() => {
    const total = this.store.total();
    if (total === null) return '';
    return this.store.totalCapped() ? `${total.toLocaleString()}+` : total.toLocaleString();
  });
  protected readonly resultUsers = computed<UserRef[]>(() => {
    const users = new Map<string, UserRef>();
    for (const ticket of this.store.items())
      if (ticket.assignee) users.set(ticket.assignee.id, ticket.assignee);
    return [...users.values()].sort((a, b) => a.displayName.localeCompare(b.displayName));
  });
  protected readonly invalidFields = computed(() =>
    Object.keys(this.store.error()?.fieldErrors ?? {}).join(', '),
  );
  protected readonly trackKey = (_: number, ticket: TicketSummary) => ticket.id;

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  private readonly viewport = viewChild(CdkVirtualScrollViewport);
  private readonly listWrap = viewChild<ElementRef<HTMLElement>>('listWrap');
  private readonly textInput = viewChild.required<ElementRef<HTMLInputElement>>('textInput');
  private textTimer: ReturnType<typeof setTimeout> | null = null;
  private prefetchTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    void inject(ProjectDirectory).load();

    effect(() => {
      const filters = parseSearchParams(this.params());
      untracked(() => {
        if (this.store.status() !== 'idle' && sameFilters(filters, this.store.filters())) return;
        if (
          document.activeElement !== this.textInput().nativeElement ||
          filters.q !== this.text().trim()
        )
          this.text.set(filters.q);
        this.store.search(filters);
      });
    });

    effect(() => {
      const wrap = this.listWrap();
      if (wrap) untracked(() => this.measure(wrap.nativeElement));
    });
    const onResize = () => {
      const wrap = this.listWrap();
      if (wrap) this.measure(wrap.nativeElement);
    };
    window.addEventListener('resize', onResize);
    const destroyRef = inject(DestroyRef);
    destroyRef.onDestroy(() => {
      window.removeEventListener('resize', onResize);
      if (this.textTimer) clearTimeout(this.textTimer);
      if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    });

    effect(() => {
      const index = this.store.focusIndex();
      const viewport = this.viewport();
      if (index < 0 || !viewport) return;
      untracked(() => this.scrollIntoView(viewport, index));
    });

    inject(ShortcutService).registerScoped([
      {
        keys: 'j',
        section: 'Search',
        description: 'Next result',
        handler: () => this.store.move(1),
      },
      {
        keys: 'k',
        section: 'Search',
        description: 'Previous result',
        handler: () => this.store.move(-1),
      },
      {
        keys: 'arrowdown',
        description: 'Next result',
        handler: () => this.store.move(1),
        showInHelp: false,
      },
      {
        keys: 'arrowup',
        description: 'Previous result',
        handler: () => this.store.move(-1),
        showInHelp: false,
      },
      {
        keys: 'enter',
        section: 'Search',
        description: 'Peek ticket',
        handler: () => this.openFocused(false),
      },
      {
        keys: 'shift+enter',
        section: 'Search',
        description: 'Open ticket full page',
        handler: () => this.openFocused(true),
      },
      {
        keys: '/',
        section: 'Search',
        description: 'Focus the search text',
        handler: () => this.focusText(),
      },
    ]);
  }

  protected onText(value: string): void {
    this.text.set(value);
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(
      () => this.navigate({ ...this.store.filters(), q: value.trim() }, true),
      TEXT_DEBOUNCE_MS,
    );
  }

  protected submitText(): void {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.navigate({ ...this.store.filters(), q: this.text().trim() }, true);
    this.textInput().nativeElement.blur();
    if (this.store.focusIndex() < 0 && this.store.items().length) this.store.focusIndex.set(0);
  }

  protected setFilters(filters: SearchFilters): void {
    this.navigate(filters, false);
  }

  protected setSort(sort: SearchSort): void {
    this.navigate({ ...this.store.filters(), sort, order: '' }, false);
  }

  protected toggleOrder(): void {
    this.navigate(
      { ...this.store.filters(), order: this.order() === 'asc' ? 'desc' : 'asc' },
      false,
    );
  }

  protected clearAll(): void {
    this.text.set('');
    this.navigate(
      { ...EMPTY_SEARCH, sort: this.store.filters().sort, order: this.store.filters().order },
      false,
    );
  }

  protected open(index: number, ticket: TicketSummary, event?: MouseEvent): void {
    this.store.focusIndex.set(index);
    if (event?.ctrlKey || event?.metaKey || event?.shiftKey)
      void this.router.navigateByUrl(ticket.url);
    else this.peek.open(ticket.key);
  }

  protected hover(key: string | null): void {
    if (this.prefetchTimer) clearTimeout(this.prefetchTimer);
    this.prefetchTimer = key ? setTimeout(() => this.cache.prefetch(key), PREFETCH_DELAY_MS) : null;
  }

  protected onScrolled(index: number): void {
    const visible = Math.ceil(this.listHeight() / this.rowHeight());
    if (index + visible * 2 >= this.store.items().length) this.store.loadMore();
  }

  private focusText(): void {
    this.textInput().nativeElement.focus();
    this.textInput().nativeElement.select();
  }

  private openFocused(fullPage: boolean): void {
    const ticket = this.store.focused();
    if (!ticket) return;
    if (fullPage) void this.router.navigateByUrl(ticket.url);
    else this.peek.open(ticket.key);
  }

  private navigate(filters: SearchFilters, replaceUrl: boolean): void {
    const queryParams: Params = toSearchParams(filters);
    const peek = this.route.snapshot.queryParamMap.get(PEEK_QUERY_PARAM);
    if (peek) queryParams[PEEK_QUERY_PARAM] = peek;
    void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl });
  }

  private measure(element: HTMLElement): void {
    requestAnimationFrame(() =>
      this.listHeight.set(Math.max(240, window.innerHeight - element.getBoundingClientRect().top)),
    );
  }

  private scrollIntoView(viewport: CdkVirtualScrollViewport, index: number): void {
    const height = this.rowHeight();
    const top = index * height;
    const offset = viewport.measureScrollOffset();
    const size = viewport.getViewportSize();
    if (top < offset) viewport.scrollToOffset(top);
    else if (top + height > offset + size) viewport.scrollToOffset(top + height - size);
  }
}
