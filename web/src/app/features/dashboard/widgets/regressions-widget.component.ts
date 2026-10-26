import { PercentPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { RegressionSessionBadgeComponent } from '@shared/ui/domain/domain-badges';
import { DashboardLinks } from '../dashboard-links';
import { RegressionPassRate, RegressionSessionSummary } from '../dashboard.model';

const SPARK_W = 208;
const SPARK_H = 56;
const PAD = 8;

/// Widget 11: the latest non-cancelled session (segmented result bar in the regression item
/// colours, pass rate, bugs) and the pass rate of the last five completed sessions as a
/// sparkline: de-emphasised line, the most recent point in the accent, every value labelled.
@Component({
  selector: 'tk-regressions-widget',
  imports: [RouterLink, PercentPipe, RelativeTimePipe, RegressionSessionBadgeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './regressions-widget.component.html',
  styleUrl: './regressions-widget.component.scss',
})
export class RegressionsWidgetComponent {
  readonly latest = input.required<RegressionSessionSummary | null>();
  readonly recent = input.required<readonly RegressionPassRate[]>();
  readonly links = input.required<DashboardLinks>();

  protected readonly width = SPARK_W;
  protected readonly height = SPARK_H;

  protected readonly segments = computed(() => {
    const s = this.latest();
    if (!s) return [];
    return [
      { id: 'passed', label: 'Passed', count: s.passed, color: 'var(--tk-run-passed)' },
      { id: 'failed', label: 'Failed', count: s.failed, color: 'var(--tk-run-failed)' },
      { id: 'skipped', label: 'Skipped', count: s.skipped, color: 'var(--tk-run-skipped)' },
      { id: 'waiting', label: 'Waiting', count: s.waiting, color: 'var(--tk-run-waiting)' },
    ];
  });

  /// Lowest value of the sparkline's scale: at most 80%, lower when a session did worse.
  protected readonly floor = computed(() => {
    const rates = this.recent()
      .map((r) => r.passRate)
      .filter((r): r is number => r !== null);
    return Math.max(0, Math.min(0.8, Math.floor((Math.min(1, ...rates) - 0.05) * 10) / 10));
  });

  protected readonly points = computed(() => {
    const recent = this.recent();
    const step = recent.length > 1 ? (SPARK_W - 2 * PAD) / (recent.length - 1) : 0;
    const floor = this.floor();
    return recent.map((r, i) => ({
      ...r,
      x: recent.length > 1 ? PAD + i * step : SPARK_W / 2,
      y: PAD + ((1 - (r.passRate ?? floor)) / (1 - floor)) * (SPARK_H - 2 * PAD),
      last: i === recent.length - 1,
    }));
  });

  protected readonly path = computed(() =>
    this.points()
      .filter((p) => p.passRate !== null)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`)
      .join(' '),
  );

  protected readonly sparkLabel = computed(() =>
    this.recent()
      .map(
        (r) =>
          `${r.key} ${r.passRate === null ? 'no results' : Math.round(r.passRate * 100) + '%'}`,
      )
      .join(', '),
  );

  protected shortKey(key: string): string {
    return key.slice(key.indexOf('-R-') + 1);
  }
}
