import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltip } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ProjectContext } from '@core/projects/project-context';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { RegressionSession } from '@core/testing/testing.models';
import { REGRESSION_SESSION_STATUSES } from '@shared/domain/enums';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { RegressionSessionBadgeComponent } from '@shared/ui/domain/domain-badges';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { SessionProgressComponent } from '../session-progress.component';
import { passRateLabel } from '../session/session-logic';
import { RegressionsStore, SessionFilter } from './regressions.store';
import { StartSessionData, StartSessionDialog } from './start-session.dialog';

/// Project "Regressions" tab: sessions newest first with progress and pass rate, and "Start regression".
@Component({
  selector: 'tk-regressions-view',
  imports: [
    MatButtonModule,
    MatTooltip,
    RouterLink,
    AbsoluteTimePipe,
    RelativeTimePipe,
    RegressionSessionBadgeComponent,
    EmptyStateComponent,
    IconComponent,
    KbdComponent,
    SegmentedControlComponent,
    SkeletonRowsComponent,
    SessionProgressComponent,
  ],
  providers: [RegressionsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-regressions.list' },
  template: `
    <header class="tk-page-header">
      <h1>Regressions</h1>
      <div class="tk-page-actions">
        @if (canWrite()) {
          <button mat-stroked-button type="button" data-testid="regression-start" (click)="start()">
            <tk-icon name="tablerPlus" [size]="14" />Start regression<tk-kbd>N</tk-kbd>
          </button>
        }
      </div>
    </header>
    <div class="tk-toolbar">
      <tk-segmented
        ariaLabel="Session status"
        testId="regression-filter"
        [options]="filterOptions"
        [value]="filter()"
        (valueChange)="setFilter($event)"
      />
    </div>

    @if (store.status() === 'error' && !store.hasData()) {
      <tk-empty-state
        icon="tablerAlertCircle"
        tone="danger"
        title="Couldn't load regression sessions"
        [description]="store.error()?.title ?? null"
      >
        <button mat-stroked-button type="button" (click)="store.reload()">Retry</button>
      </tk-empty-state>
    } @else if (!store.hasData()) {
      <tk-skeleton-rows [count]="6" />
    } @else if (store.sessions().length === 0) {
      <tk-empty-state
        icon="tablerHistory"
        title="No regression sessions"
        [description]="
          canWrite()
            ? 'Start one to run every Manual and Automatic test case against a version.'
            : 'No one has run a regression in this project yet.'
        "
        learnLabel="How regressions work"
        (learn)="explain()"
      >
        @if (canWrite() && filter() === 'All') {
          <button mat-flat-button type="button" (click)="start()">
            Start regression <tk-kbd tone="on-solid">N</tk-kbd>
          </button>
        }
      </tk-empty-state>
    } @else {
      <div class="cols" aria-hidden="true" data-testid="regression-columns">
        <span class="badge">Status</span>
        <span class="key">Key</span>
        <span class="name">Name</span>
        <span class="prog">Progress</span>
        <span class="failed">Failed</span>
        <span class="rate">Pass rate</span>
        <span class="by">Started</span>
      </div>
      <div class="list" role="list" data-testid="regression-list">
        @for (s of store.sessions(); track s.id) {
          <a
            class="row"
            role="listitem"
            [routerLink]="[s.key]"
            [attr.data-testid]="'session-row-' + s.key"
          >
            <span class="badge"><tk-regression-session-badge [status]="s.status" /></span>
            <span class="key tnum">{{ s.key }}</span>
            <span class="name">
              <span class="n">{{ s.name }}</span>
              @if (s.version) {
                <span class="ver tnum">{{ s.version }}</span>
              }
            </span>
            <span class="prog">
              <tk-session-progress [summary]="s.summary" />
              <span class="tnum done"
                >{{ s.summary.total - s.summary.waiting }}/{{ s.summary.total }}</span
              >
            </span>
            <span class="failed tnum" [class.has]="s.summary.failed > 0">
              @if (s.summary.failed > 0) {
                {{ s.summary.failed }} failed
              }
            </span>
            <span class="rate tnum" matTooltip="Pass rate = passed / (passed + failed)">{{
              passRate(s.summary)
            }}</span>
            <span class="by">
              {{ s.startedBy.displayName }} ·
              <span [title]="s.startedAt | absoluteTime">{{ s.startedAt | relativeTime }}</span>
            </span>
          </a>
        }
        @if (store.nextCursor()) {
          <button
            type="button"
            class="more"
            [disabled]="store.loadingMore()"
            (click)="store.loadMore()"
          >
            {{ store.loadingMore() ? 'Loading…' : 'Load more' }}
          </button>
        }
      </div>
    }
  `,
  styleUrl: './regressions.view.scss',
})
export class RegressionsView {
  protected readonly store = inject(RegressionsStore);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly project = inject(ProjectContext);

  readonly projectKey = input.required<string>();
  readonly status = input<string | null>(null);

  protected readonly passRate = passRateLabel;
  protected readonly filterOptions: SegmentOption<SessionFilter>[] = [
    { value: 'All', label: 'All' },
    { value: 'InProgress', label: 'In progress' },
    { value: 'Completed', label: 'Completed' },
    { value: 'Cancelled', label: 'Cancelled' },
  ];
  protected readonly filter = computed<SessionFilter>(() => {
    const value = this.status();
    return (REGRESSION_SESSION_STATUSES as readonly string[]).includes(value ?? '')
      ? (value as SessionFilter)
      : 'All';
  });
  protected readonly canWrite = computed(() => {
    const p = this.project.project();
    return !!p && !p.archivedAt && (p.myRole === 'Owner' || p.myRole === 'Member');
  });

  constructor() {
    effect(() => {
      const projectKey = this.projectKey();
      const filter = this.filter();
      untracked(() => void this.store.load(projectKey, filter));
    });
    inject(ShortcutService).registerScoped(
      [
        {
          keys: 'n',
          description: 'Start a regression session',
          section: 'Regressions',
          handler: () => this.canWrite() && this.start(),
        },
      ],
      inject(DestroyRef),
    );
  }

  protected setFilter(filter: SessionFilter): void {
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { status: filter === 'All' ? null : filter },
      replaceUrl: true,
    });
  }

  protected async start(): Promise<void> {
    const ref = this.dialog.open<StartSessionDialog, StartSessionData, RegressionSession | null>(
      StartSessionDialog,
      {
        data: { projectKey: this.projectKey() },
        width: '520px',
        autoFocus: 'first-tabbable',
      },
    );
    const session = await firstValueFrom(ref.afterClosed());
    if (session) void this.router.navigate([session.key], { relativeTo: this.route });
  }

  protected async explain(): Promise<void> {
    const { RegressionsExplainerDialog } = await import('./regressions-explainer.dialog');
    this.dialog.open(RegressionsExplainerDialog, {
      width: '480px',
      autoFocus: 'first-tabbable',
      ariaLabelledBy: 'regressions-explainer-title',
    });
  }
}
