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
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggle } from '@angular/material/slide-toggle';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { filter, firstValueFrom, map } from 'rxjs';
import { PeekService } from '@core/layout/peek/peek';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { LearnActions } from '@core/onboarding/learn-actions';
import { ProjectContext } from '@core/projects/project-context';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { TestCaseSummary } from '@core/testing/testing.models';
import { TicketRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import { REGRESSION_ITEM_STATUS_LABELS } from '@shared/domain/enums';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { TestCaseStatusBadgeComponent } from '@shared/ui/domain/domain-badges';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { RUN_STATUS_ICONS, TEST_CASE_ICONS } from '../test-case-icons';
import {
  EMPTY_FILTERS,
  filtersFromQuery,
  filtersToQuery,
  isFiltered,
  StatusFilter,
  TestCaseFilters,
} from './test-case-list-logic';
import { TestCasesStore } from './test-cases.store';

const TEXT_DEBOUNCE_MS = 250;

/// Project "Test cases" tab: dense list with counts by status, filters in the URL, and the editor in a
/// side pane (child route `:testCaseKey` or `new`), so the list keeps its place while editing.
@Component({
  selector: 'tk-test-cases-view',
  imports: [
    TourAnchorDirective,
    MatButtonModule,
    MatSlideToggle,
    MatTooltip,
    RouterLink,
    RouterOutlet,
    RelativeTimePipe,
    TestCaseStatusBadgeComponent,
    TypeIconComponent,
    EmptyStateComponent,
    IconComponent,
    KbdComponent,
    SearchPickerDirective,
    SegmentedControlComponent,
    SkeletonRowsComponent,
  ],
  providers: [TestCasesStore],
  viewProviders: [provideIcons(TEST_CASE_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-testcases.list' },
  templateUrl: './test-cases.view.html',
  styleUrl: './test-cases.view.scss',
})
export class TestCasesView {
  protected readonly store = inject(TestCasesStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly project = inject(ProjectContext);
  protected readonly learn = inject(LearnActions);
  private readonly peek = inject(PeekService);
  private readonly tickets = inject(TicketsApi);
  private readonly destroyRef = inject(DestroyRef);

  readonly projectKey = input.required<string>();
  readonly status = input<string | null>(null);
  readonly q = input<string | null>(null);
  readonly ticket = input<string | null>(null);
  readonly archived = input<string | null>(null);

  private readonly filterInput = viewChild<ElementRef<HTMLInputElement>>('filter');
  private textTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly runIcons = RUN_STATUS_ICONS;
  protected readonly runLabels = REGRESSION_ITEM_STATUS_LABELS;
  protected readonly filters = computed(() =>
    filtersFromQuery({
      status: this.status(),
      q: this.q(),
      ticket: this.ticket(),
      archived: this.archived(),
    }),
  );
  protected readonly canWrite = computed(() => {
    const p = this.project.project();
    return !!p && !p.archivedAt && (p.myRole === 'Owner' || p.myRole === 'Member');
  });
  protected readonly statusOptions = computed<SegmentOption<StatusFilter>[]>(() => {
    const c = this.store.counts();
    return [
      { value: 'All', label: 'All', count: c.active },
      { value: 'New', label: 'New', count: c.new },
      { value: 'Manual', label: 'Manual', count: c.manual },
      { value: 'Automatic', label: 'Automatic', count: c.automatic },
    ];
  });
  protected readonly filtered = computed(() => isFiltered(this.filters()));
  protected readonly focusIndex = signal(-1);
  protected readonly selectedKey = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.childKey()),
    ),
    { initialValue: this.childKey() },
  );
  protected readonly paneOpen = signal(false);

  protected readonly ticketSearch = async (query: string): Promise<PickerOption<TicketRef>[]> =>
    (await firstValueFrom(this.tickets.find(this.projectKey(), query))).map((t) => ({
      value: t,
      label: `${t.key} ${t.title}`,
    }));

  constructor() {
    effect(() => {
      const projectKey = this.projectKey();
      const filters = this.filters();
      untracked(() => void this.store.load(projectKey, filters));
    });
    effect(() => {
      const key = this.selectedKey();
      const index = untracked(() => this.store.items().findIndex((r) => r.key === key));
      if (index >= 0) untracked(() => this.focusIndex.set(index));
    });

    inject(ShortcutService).registerScoped(
      [
        {
          keys: 'j',
          description: 'Next test case',
          section: 'Test cases',
          handler: () => this.move(1),
        },
        {
          keys: 'k',
          description: 'Previous test case',
          section: 'Test cases',
          handler: () => this.move(-1),
        },
        {
          keys: 'enter',
          description: 'Open the focused test case',
          section: 'Test cases',
          handler: () => this.openFocused(),
        },
        {
          keys: '/',
          description: 'Filter test cases',
          section: 'Test cases',
          handler: (e) => this.focusFilter(e),
        },
        {
          keys: 'n',
          description: 'New test case',
          section: 'Test cases',
          handler: () => this.canWrite() && this.openNew(),
        },
      ],
      this.destroyRef,
    );
    this.destroyRef.onDestroy(() => clearTimeout(this.textTimer));
  }

  protected setStatus(status: StatusFilter): void {
    this.navigate({ ...this.filters(), status });
  }

  protected onText(text: string): void {
    clearTimeout(this.textTimer);
    this.textTimer = setTimeout(() => this.navigate({ ...this.filters(), text }), TEXT_DEBOUNCE_MS);
  }

  protected setTicket(ticketKey: string | null): void {
    this.navigate({ ...this.filters(), ticket: ticketKey });
  }

  protected setArchived(archived: boolean): void {
    this.navigate({ ...this.filters(), archived });
  }

  protected clearFilters(): void {
    if (this.filterInput()) this.filterInput()!.nativeElement.value = '';
    this.navigate(EMPTY_FILTERS);
  }

  protected open(row: TestCaseSummary, index: number): void {
    this.focusIndex.set(index);
    void this.router.navigate([row.key], {
      relativeTo: this.route,
      queryParamsHandling: 'preserve',
    });
  }

  protected openNew(): void {
    void this.router.navigate(['new'], { relativeTo: this.route, queryParamsHandling: 'preserve' });
  }

  protected peekTicket(event: Event, key: string): void {
    event.stopPropagation();
    this.peek.open(key);
  }

  protected trackRow(_: number, row: TestCaseSummary): string {
    return row.id;
  }

  private navigate(filters: TestCaseFilters): void {
    void this.router.navigate([], {
      relativeTo: this.route.firstChild ?? this.route,
      queryParams: filtersToQuery(filters),
      replaceUrl: true,
    });
  }

  private move(step: number): void {
    const count = this.store.items().length;
    if (count === 0) return;
    const next = Math.min(count - 1, Math.max(0, this.focusIndex() + step));
    this.focusIndex.set(next);
    document
      .querySelector(`[data-testid="tc-row-${this.store.items()[next].key}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  private openFocused(): void {
    const row = this.store.items()[this.focusIndex()];
    if (row) this.open(row, this.focusIndex());
  }

  private focusFilter(event: KeyboardEvent): void {
    event.preventDefault();
    this.filterInput()?.nativeElement.focus();
  }

  private childKey(): string | null {
    return this.route.firstChild?.snapshot.paramMap.get('testCaseKey')?.toUpperCase() ?? null;
  }
}
