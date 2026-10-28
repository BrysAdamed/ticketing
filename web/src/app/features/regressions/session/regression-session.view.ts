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
import { MatButtonModule } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { provideIcons } from '@ng-icons/core';
import { tablerPlayerTrackNext, tablerRotate, tablerUserCheck } from '@ng-icons/tabler-icons';
import { ConfirmService } from '@core/notify/confirm.service';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { RegressionItem } from '@core/testing/testing.models';
import { ProjectPeople } from '@core/tickets/project-people';
import { UserRef } from '@core/tickets/ticket.models';
import { RegressionItemStatus } from '@shared/domain/enums';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { MarkdownViewerComponent } from '@shared/markdown/markdown-viewer.component';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import {
  RegressionItemBadgeComponent,
  RegressionSessionBadgeComponent,
} from '@shared/ui/domain/domain-badges';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
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
import { SessionProgressComponent } from '../session-progress.component';
import { ChecklistStepsComponent } from './checklist-steps.component';
import { SessionItemsComponent } from './session-items.component';
import { ItemFilter, parseFilter, passRateLabel } from './session-logic';
import { RegressionSessionStore } from './regression-session.store';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// Regression session execution (layout-and-screens §3.8), built for speed of manual testing: item
/// list on the left, the snapshot on the right, Pass / Fail / Skip with p / f / s, j / k to move,
/// n for the next waiting item. Failing asks for the actual result and offers the pre-filled bug.
@Component({
  selector: 'tk-regression-session-view',
  imports: [
    TourAnchorDirective,
    MatButtonModule,
    MatCheckbox,
    MatMenuModule,
    MatTooltip,
    RouterLink,
    MarkdownEditorComponent,
    MarkdownViewerComponent,
    AbsoluteTimePipe,
    RelativeTimePipe,
    RegressionItemBadgeComponent,
    RegressionSessionBadgeComponent,
    UserDisplayComponent,
    EmptyStateComponent,
    IconComponent,
    KbdComponent,
    SearchPickerDirective,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    SessionProgressComponent,
    ChecklistStepsComponent,
    SessionItemsComponent,
  ],
  providers: [RegressionSessionStore],
  viewProviders: [provideIcons({ tablerPlayerTrackNext, tablerRotate, tablerUserCheck })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-regressions.session' },
  templateUrl: './regression-session.view.html',
  styleUrl: './regression-session.view.scss',
})
export class RegressionSessionView {
  protected readonly store = inject(RegressionSessionStore);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly confirm = inject(ConfirmService);
  private readonly people = inject(ProjectPeople);

  readonly projectKey = input.required<string>();
  readonly sessionKey = input.required<string>();
  readonly item = input<string | null>(null);
  readonly show = input<string | null>(null);

  private readonly paneBody = viewChild<ElementRef<HTMLElement>>('paneBody');
  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly passRate = passRateLabel;
  protected readonly failing = signal(false);
  protected readonly failNote = signal('');
  protected readonly createBug = signal(true);

  protected readonly filterOptions = computed<SegmentOption<ItemFilter>[]>(() => {
    const c = this.store.counts();
    return [
      { value: 'mine', label: 'Mine', count: c.mine },
      { value: 'waiting', label: 'Waiting', count: c.waiting },
      { value: 'failed', label: 'Failed', count: c.failed },
      { value: 'all', label: 'All', count: c.all },
    ];
  });
  protected readonly canAct = computed(() => this.store.permissions().canExecute);
  protected readonly readOnlyReason = computed(() => {
    const s = this.store.session();
    if (!s) return null;
    if (s.status === 'Completed')
      return `Completed by ${s.completedBy?.displayName ?? 'someone'}. The session is read-only.`;
    if (s.status === 'Cancelled')
      return `Cancelled by ${s.cancelledBy?.displayName ?? 'someone'}. The session is read-only.`;
    if (!s.permissions.canExecute) return 'You have read-only access to this project.';
    return null;
  });

  protected readonly assigneeSearch = async (query: string): Promise<PickerOption<UserRef>[]> =>
    (await this.people.search(this.projectKey(), query)).map((u) => ({
      value: u,
      label: u.displayName,
      keywords: [u.email],
    }));

  constructor() {
    effect(() => {
      const key = this.sessionKey();
      untracked(() => void this.store.load(key, this.item()?.toUpperCase() ?? null));
    });
    effect(() => {
      const filter = parseFilter(this.show());
      untracked(() => this.store.filter.set(filter));
    });
    effect(() => {
      const key = this.store.focusedKey();
      untracked(() => {
        this.failing.set(false);
        if (key && key !== this.item()?.toUpperCase()) this.syncUrl({ item: key });
        this.paneBody()?.nativeElement.scrollTo({ top: 0 });
        document
          .querySelector(`[data-testid="item-row-${key}"]`)
          ?.scrollIntoView({ block: 'nearest' });
      });
    });

    const section = 'Regression session';
    inject(ShortcutService).registerScoped(
      [
        {
          keys: 'p',
          description: 'Pass the focused item',
          section,
          handler: () => this.result('Passed'),
        },
        {
          keys: 'f',
          description: 'Fail the focused item',
          section,
          handler: (e) => this.startFail(e),
        },
        {
          keys: 's',
          description: 'Skip the focused item',
          section,
          handler: () => this.result('Skipped'),
        },
        {
          keys: 'w',
          description: 'Back to waiting',
          section,
          handler: () => this.result('WaitingForExecution'),
        },
        { keys: 'i', description: 'Take (assign to me)', section, handler: () => this.take() },
        {
          keys: 'n',
          description: 'Next waiting item',
          section,
          handler: () => this.store.focusNextWaiting(),
        },
        { keys: 'j', description: 'Next item', section, handler: () => this.store.step(1) },
        { keys: 'k', description: 'Previous item', section, handler: () => this.store.step(-1) },
        {
          keys: 'mod+enter',
          description: 'Confirm the failure',
          section,
          allowInInputs: true,
          handler: () => this.failing() && this.confirmFail(),
        },
        {
          keys: 'escape',
          description: 'Close the failure panel',
          section,
          allowInInputs: true,
          handler: () => this.failing.set(false),
        },
      ],
      inject(DestroyRef),
    );
  }

  protected setFilter(filter: ItemFilter): void {
    this.store.filter.set(filter);
    this.syncUrl({ show: filter === 'all' ? null : filter });
  }

  protected async take(): Promise<void> {
    const item = this.store.focused();
    if (!item || !this.canAct() || item.assignee?.id === this.store.meId()) return;
    if (this.store.takenByOther(item) && !(await this.confirmTakeOver(item))) return;
    await this.store.take(item);
  }

  protected async assign(user: UserRef | null): Promise<void> {
    const item = this.store.focused();
    if (item) await this.store.assign(item, user);
  }

  protected async result(status: RegressionItemStatus): Promise<void> {
    const item = this.store.focused();
    if (!item || !this.canAct()) return;
    const takeOver = this.store.takenByOther(item);
    if (takeOver && !(await this.confirmTakeOver(item))) return;
    const recorded = this.store.record(item, status, null, takeOver);
    if (status !== 'WaitingForExecution') {
      if (takeOver) await recorded;
      this.store.focusNextWaiting();
    }
    await recorded;
  }

  protected startFail(event?: Event): void {
    const item = this.store.focused();
    if (!item || !this.canAct()) return;
    event?.preventDefault();
    this.failNote.set(item.status === 'Failed' ? (item.resultNote ?? '') : '');
    this.createBug.set(!item.bug);
    this.failing.set(true);
    setTimeout(() =>
      document.querySelector<HTMLTextAreaElement>('[data-testid="fail-note"] textarea')?.focus(),
    );
  }

  protected async confirmFail(): Promise<void> {
    const item = this.store.focused();
    const note = this.failNote().trim();
    if (!item || !note || !this.failing()) return;
    const takeOver = this.store.takenByOther(item);
    if (takeOver && !(await this.confirmTakeOver(item))) return;
    this.failing.set(false);
    const recording = this.store.record(item, 'Failed', note, takeOver);
    if (!this.createBug() || item.bug) {
      this.store.focusNextWaiting();
      await recording;
      return;
    }
    const recorded = await recording;
    if (!recorded) return;
    await this.store.createBug(recorded);
    if (this.store.focusedKey() === recorded.testCaseKey) this.store.focusNextWaiting();
  }

  protected async complete(): Promise<void> {
    await this.store.settled();
    const summary = this.store.summary();
    if (!summary) return;
    const waiting = summary.waiting;
    const ok = await this.confirm.confirm({
      title: `Complete ${this.store.sessionKey()}?`,
      message:
        waiting > 0
          ? `${waiting} ${waiting === 1 ? 'item is' : 'items are'} still waiting and will be marked Skipped ("Skipped at completion"). The session becomes read-only.`
          : 'The session and its results become read-only.',
      confirmLabel: waiting > 0 ? `Skip ${waiting} and complete` : 'Complete session',
    });
    if (ok) await this.store.complete(waiting > 0);
  }

  protected async cancel(): Promise<void> {
    const ok = await this.confirm.confirm({
      title: `Cancel ${this.store.sessionKey()}?`,
      message:
        'Recorded results stay, but the session becomes read-only and is left out of dashboard trends.',
      confirmLabel: 'Cancel session',
      danger: true,
    });
    if (ok) await this.store.cancel();
  }

  private confirmTakeOver(item: RegressionItem): Promise<boolean> {
    return this.confirm.confirm({
      title: `Take over ${item.testCaseKey}?`,
      message: `${item.assignee?.displayName ?? 'Someone'} is assigned to this item. Taking it assigns it to you.`,
      confirmLabel: 'Take over',
    });
  }

  private syncUrl(params: Record<string, string | null>): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: params,
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
