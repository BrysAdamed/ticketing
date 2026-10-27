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
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerChalkboard, tablerFolder, tablerSitemap } from '@ng-icons/tabler-icons';
import { docKindIcon, DocSearchItem } from '@core/docs/doc-search.api';
import { ProjectDirectory } from '@core/projects/project-directory';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { HighlightedTextComponent } from '@shared/ui/highlighted-text/highlighted-text.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { queryRanges } from '@shared/util/highlight';
import {
  DOC_KINDS,
  DocSearchFilters,
  effectiveDocSort,
  EMPTY_DOC_SEARCH,
  hasDocFilters,
  parseDocSearchParams,
  sameDocFilters,
  toDocSearchParams,
} from './doc-search-query';
import { DocSearchStore } from './doc-search.store';
import { docLocation } from './quick-jump';
import { DATE_PRESETS, DatePreset, rangeLabel, utcDate } from './search-query';

const TEXT_DEBOUNCE_MS = 250;
const KIND_LABELS: Record<string, string> = {
  Page: 'Pages',
  Diagram: 'Diagrams',
  Folder: 'Folders',
};

/// The Docs scope of the search page (spec 12.7): text, project, kind and updated filters, folder
/// and mention filters from links, relevance or newest first, results with plain-text snippets.
/// Everything lives in the URL next to `scope=docs`. `J`/`K` move, `Enter` opens, `/` focuses the text.
@Component({
  selector: 'tk-doc-search',
  imports: [
    MatButtonModule,
    MatMenuModule,
    RouterLink,
    AbsoluteTimePipe,
    RelativeTimePipe,
    EmptyStateComponent,
    HighlightedTextComponent,
    IconComponent,
    KbdComponent,
    ProjectTileComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
  ],
  providers: [DocSearchStore],
  viewProviders: [provideIcons({ tablerChalkboard, tablerFolder, tablerSitemap })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'doc-search' },
  templateUrl: './doc-search.component.html',
  styleUrls: ['./filter-chips.scss', './doc-search.component.scss'],
})
export class DocSearchComponent {
  protected readonly store = inject(DocSearchStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly projects = inject(ProjectDirectory).projects;
  protected readonly kinds = DOC_KINDS;
  protected readonly kindLabels = KIND_LABELS;
  protected readonly presets = DATE_PRESETS;
  protected readonly text = signal('');
  protected readonly f = this.store.filters;
  protected readonly filtered = computed(() => hasDocFilters(this.f()));
  protected readonly chipFilters = computed(() => hasDocFilters({ ...this.f(), q: '' }));
  protected readonly sort = computed(() => effectiveDocSort(this.f()));
  protected readonly sortOptions = computed<SegmentOption<'relevance' | 'updated'>[]>(() =>
    this.f().q.trim()
      ? [
          { value: 'relevance', label: 'Relevance' },
          { value: 'updated', label: 'Updated' },
        ]
      : [{ value: 'updated', label: 'Updated' }],
  );
  protected readonly countLabel = computed(() => {
    const total = this.store.total();
    if (total === null) return '';
    const count = this.store.totalCapped() ? `${total.toLocaleString()}+` : total.toLocaleString();
    return `${count} ${total === 1 ? 'doc' : 'docs'}`;
  });
  protected readonly relevanceCapped = computed(
    () => this.sort() === 'relevance' && (this.store.total() ?? 0) > this.store.items().length,
  );
  protected readonly invalidFields = computed(() =>
    Object.keys(this.store.error()?.fieldErrors ?? {}).join(', '),
  );

  private readonly params = toSignal(this.route.queryParams, { initialValue: {} as Params });
  private readonly textInput = viewChild.required<ElementRef<HTMLInputElement>>('textInput');
  private readonly list = viewChild<ElementRef<HTMLElement>>('list');
  private textTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => {
      const filters = parseDocSearchParams(this.params());
      untracked(() => {
        if (this.store.status() !== 'idle' && sameDocFilters(filters, this.store.filters())) return;
        if (
          document.activeElement !== this.textInput().nativeElement ||
          filters.q !== this.text().trim()
        )
          this.text.set(filters.q);
        this.store.search(filters);
      });
    });

    effect(() => {
      const index = this.store.focusIndex();
      const list = this.list();
      if (index < 0 || !list) return;
      untracked(() =>
        list.nativeElement
          .querySelector<HTMLElement>(`[data-index="${index}"]`)
          ?.scrollIntoView({ block: 'nearest' }),
      );
    });

    inject(DestroyRef).onDestroy(() => {
      if (this.textTimer) clearTimeout(this.textTimer);
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
        description: 'Open doc',
        handler: () => this.openFocused(),
      },
      {
        keys: '/',
        section: 'Search',
        description: 'Focus the search text',
        handler: () => this.focusText(),
      },
    ]);
  }

  protected icon(item: DocSearchItem): string {
    return docKindIcon(item.kind, item.diagramFormat);
  }

  protected location(item: DocSearchItem): string {
    return docLocation(item.projectKey, item.folderPath);
  }

  protected titleRanges(item: DocSearchItem): { start: number; length: number }[] {
    return queryRanges(item.title, this.f().q);
  }

  protected summary(values: readonly string[]): string {
    return values.length <= 2 ? values.join(', ') : `${values.length}`;
  }

  protected rangeLabel(from: string, to: string): string {
    return rangeLabel(from, to);
  }

  protected onText(value: string): void {
    this.text.set(value);
    if (this.textTimer) clearTimeout(this.textTimer);
    this.textTimer = setTimeout(
      () => this.navigate({ ...this.f(), q: value.trim() }, true),
      TEXT_DEBOUNCE_MS,
    );
  }

  protected submitText(): void {
    if (this.textTimer) clearTimeout(this.textTimer);
    this.navigate({ ...this.f(), q: this.text().trim() }, true);
    this.textInput().nativeElement.blur();
    if (this.store.focusIndex() < 0 && this.store.items().length) this.store.focusIndex.set(0);
  }

  protected toggle(field: 'project' | 'kind', value: string): void {
    const current = this.f()[field];
    this.patch({
      [field]: current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
    });
  }

  protected setRange(preset: DatePreset | null): void {
    const now = new Date();
    this.patch({
      updatedFrom: preset?.from !== undefined ? utcDate(now, preset.from) : '',
      updatedTo: preset?.to !== undefined ? utcDate(now, preset.to) : '',
    });
  }

  protected setSort(sort: 'relevance' | 'updated'): void {
    this.patch({ sort: sort === 'relevance' ? '' : 'updated' });
  }

  protected patch(change: Partial<DocSearchFilters>): void {
    this.navigate({ ...this.f(), ...change }, false);
  }

  protected clearChips(): void {
    this.navigate({ ...EMPTY_DOC_SEARCH, q: this.f().q, sort: this.f().sort }, false);
  }

  protected clearAll(): void {
    this.text.set('');
    this.navigate(EMPTY_DOC_SEARCH, false);
  }

  private openFocused(): void {
    const item = this.store.focused();
    if (item) void this.router.navigateByUrl(item.url);
  }

  private focusText(): void {
    this.textInput().nativeElement.focus();
    this.textInput().nativeElement.select();
  }

  private navigate(filters: DocSearchFilters, replaceUrl: boolean): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: toDocSearchParams(filters),
      replaceUrl,
    });
  }
}
