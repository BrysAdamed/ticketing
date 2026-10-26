import { DOCUMENT } from '@angular/common';
import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '@core/theme/theme.service';
import { provideIcons } from '@ng-icons/core';
import { tablerChartLine, tablerTable } from '@ng-icons/tabler-icons';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  CategoryScale,
  ChartConfiguration,
  ChartEvent,
  LinearScale,
  LineController,
  LineElement,
  Plugin,
  PointElement,
  Tooltip,
} from 'chart.js';
import { BaseChartDirective, provideCharts } from 'ng2-charts';
import { DashboardLinks } from '../dashboard-links';
import { WeekCount } from '../dashboard.model';

interface Palette {
  created: string;
  resolved: string;
  grid: string;
  tick: string;
  surface: string;
  raised: string;
  border: string;
  text: string;
  muted: string;
  crosshair: string;
}

const SERIES = [
  { key: 'created', label: 'Created' },
  { key: 'resolved', label: 'Resolved' },
] as const;

const weekLabel = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/// Vertical hairline that follows the tooltip, so the reader aims at a week, not at a 2px line.
const crosshair: Plugin<'line'> = {
  id: 'tkCrosshair',
  afterDatasetsDraw(chart) {
    const active = chart.tooltip?.getActiveElements() ?? [];
    if (active.length === 0) return;
    const x = active[0].element.x;
    const { top, bottom } = chart.chartArea;
    const ctx = chart.ctx;
    ctx.save();
    ctx.strokeStyle =
      (chart.options.plugins as { tkCrosshair?: { color: string } }).tkCrosshair?.color ?? '#999';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, top);
    ctx.lineTo(Math.round(x) + 0.5, bottom);
    ctx.stroke();
    ctx.restore();
  },
};

/// Widget 6: tickets created vs tickets resolved per ISO week, last 12 weeks. Two 2px lines on
/// one axis (created `--tk-palette-0`, resolved `--tk-category-done`), a legend with this week's
/// values, a crosshair tooltip, and a table view with every number linked to its search.
@Component({
  selector: 'tk-created-resolved-chart',
  imports: [BaseChartDirective, IconComponent, MatTooltip, RouterLink],
  providers: [
    provideCharts({
      registerables: [
        LineController,
        LineElement,
        PointElement,
        LinearScale,
        CategoryScale,
        Tooltip,
      ],
    }),
  ],
  viewProviders: [provideIcons({ tablerTable, tablerChartLine })],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="top">
      <ul class="legend">
        @for (series of series; track series.key) {
          <li>
            <span
              class="key"
              [style.background]="'var(--tk-' + colorToken[series.key] + ')'"
            ></span>
            <span class="name">{{ series.label }}</span>
            <strong class="tnum">{{ thisWeek()[series.key] }}</strong>
            <span class="muted">this week</span>
          </li>
        }
      </ul>
      <button
        type="button"
        class="tk-icon-btn"
        [attr.aria-pressed]="showTable()"
        [attr.aria-label]="showTable() ? 'Show chart' : 'Show table'"
        [matTooltip]="showTable() ? 'Show chart' : 'Show table'"
        data-testid="created-resolved-toggle"
        (click)="showTable.set(!showTable())"
      >
        <tk-icon [name]="showTable() ? 'tablerChartLine' : 'tablerTable'" [size]="16" />
      </button>
    </div>
    @if (showTable()) {
      <table data-testid="created-resolved-table">
        <thead>
          <tr>
            <th scope="col">Week</th>
            <th scope="col">Created</th>
            <th scope="col">Resolved</th>
          </tr>
        </thead>
        <tbody>
          @for (week of weeks(); track week.weekStart) {
            <tr>
              <th scope="row">
                {{ week.isoWeek }} <span class="muted">{{ label(week) }}</span>
              </th>
              <td>
                <a
                  [routerLink]="links().createdIn(week).path"
                  [queryParams]="links().createdIn(week).query"
                  >{{ week.created }}</a
                >
              </td>
              <td>
                <a
                  [routerLink]="links().resolvedIn(week).path"
                  [queryParams]="links().resolvedIn(week).query"
                  >{{ week.resolved }}</a
                >
              </td>
            </tr>
          }
        </tbody>
      </table>
    } @else {
      <div class="canvas">
        <canvas
          baseChart
          type="line"
          [data]="chartData()"
          [options]="options()"
          [plugins]="plugins"
          role="img"
          [attr.aria-label]="summary()"
          (chartClick)="open($event)"
        ></canvas>
      </div>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
    }
    .top {
      display: flex;
      align-items: center;
      margin-bottom: 8px;
    }
    .legend {
      list-style: none;
      display: flex;
      gap: 20px;
      margin: 0;
      padding: 0;
      font-size: var(--tk-text-sm);
    }
    .legend li {
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .key {
      width: 14px;
      height: 2px;
      border-radius: 1px;
    }
    .name {
      color: var(--tk-text-muted);
    }
    strong {
      font-weight: var(--tk-weight-semibold);
    }
    .muted {
      color: var(--tk-text-subtle);
    }
    .tk-icon-btn {
      margin-left: auto;
    }
    .canvas {
      position: relative;
      height: 216px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--tk-text-sm);
      font-variant-numeric: tabular-nums;
    }
    th,
    td {
      height: 24px;
      padding: 0 8px;
      text-align: right;
      border-bottom: 1px solid var(--tk-border-subtle);
    }
    th[scope='row'],
    thead th:first-child {
      text-align: left;
      font-weight: var(--tk-weight-medium);
    }
    thead th {
      color: var(--tk-text-muted);
      font-weight: var(--tk-weight-medium);
    }
    a {
      color: var(--tk-text);
      text-decoration: none;
    }
    a:hover {
      color: var(--tk-accent-fg);
      text-decoration: underline;
    }
  `,
})
export class CreatedResolvedChartComponent {
  private readonly document = inject(DOCUMENT);
  private readonly router = inject(Router);
  private readonly theme = inject(ThemeService);

  readonly weeks = input.required<readonly WeekCount[]>();
  readonly links = input.required<DashboardLinks>();

  protected readonly series = SERIES;
  protected readonly colorToken = { created: 'palette-0', resolved: 'category-done' } as const;
  protected readonly plugins = [crosshair];
  protected readonly showTable = signal(false);
  private readonly palette = signal<Palette | null>(null);

  protected readonly thisWeek = computed(() => this.weeks().at(-1) ?? { created: 0, resolved: 0 });
  protected readonly summary = computed(() => {
    const weeks = this.weeks();
    const created = weeks.reduce((sum, w) => sum + w.created, 0);
    const resolved = weeks.reduce((sum, w) => sum + w.resolved, 0);
    return `Last ${weeks.length} weeks: ${created} created, ${resolved} resolved. Use the table view for weekly numbers.`;
  });

  protected readonly chartData = computed<ChartConfiguration<'line'>['data']>(() => {
    const palette = this.palette();
    const weeks = this.weeks();
    return {
      labels: weeks.map((w) => this.label(w)),
      datasets: SERIES.map((s) => {
        const color = palette?.[s.key] ?? 'transparent';
        return {
          label: s.label,
          data: weeks.map((w) => w[s.key]),
          borderColor: color,
          backgroundColor: color,
          borderWidth: 2,
          borderJoinStyle: 'round' as const,
          borderCapStyle: 'round' as const,
          tension: 0,
          pointRadius: weeks.map((_, i) => (i === weeks.length - 1 ? 4 : 0)),
          pointHoverRadius: 5,
          pointHitRadius: 12,
          pointBorderWidth: 2,
          pointBorderColor: palette?.surface ?? 'transparent',
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: palette?.surface ?? 'transparent',
        };
      }),
    };
  });

  protected readonly options = computed<ChartConfiguration<'line'>['options']>(() => {
    const p = this.palette();
    return {
      animation: false,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 6, right: 6 } },
      scales: {
        x: {
          grid: { display: false },
          border: { color: p?.grid },
          ticks: { color: p?.tick, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 12 },
        },
        y: {
          beginAtZero: true,
          grid: { color: p?.grid },
          border: { display: false },
          ticks: { color: p?.tick, font: { size: 11 }, precision: 0, maxTicksLimit: 5 },
        },
      },
      plugins: {
        legend: { display: false },
        tkCrosshair: { color: p?.crosshair },
        tooltip: {
          backgroundColor: p?.raised,
          borderColor: p?.border,
          borderWidth: 1,
          titleColor: p?.muted,
          bodyColor: p?.text,
          titleFont: { size: 11, weight: 500 },
          bodyFont: { size: 12 },
          padding: 8,
          cornerRadius: 6,
          boxWidth: 10,
          boxHeight: 2,
          boxPadding: 6,
          caretSize: 0,
          callbacks: {
            title: (items) => {
              const week = this.weeks()[items[0]?.dataIndex ?? 0];
              return week ? `${week.isoWeek} · week of ${this.label(week)}` : '';
            },
            label: (item) => ` ${item.formattedValue}  ${item.dataset.label}`,
            labelColor: (item) => ({
              borderColor: String(item.dataset.borderColor),
              backgroundColor: String(item.dataset.borderColor),
            }),
          },
        },
      },
    } as ChartConfiguration<'line'>['options'];
  });

  constructor() {
    afterRenderEffect(() => {
      this.theme.theme();
      this.palette.set(this.readPalette());
    });
  }

  protected label(week: WeekCount): string {
    return weekLabel.format(new Date(`${week.weekStart}T00:00:00Z`));
  }

  protected open(event: { event?: ChartEvent; active?: object[] }): void {
    const active = (event.active ?? []) as { index: number; datasetIndex: number }[];
    const hit = active[0];
    if (!hit) return;
    const week = this.weeks()[hit.index];
    const nearest = active.length > 1 ? this.nearestSeries(event.event, active) : hit.datasetIndex;
    const link = nearest === 0 ? this.links().createdIn(week) : this.links().resolvedIn(week);
    void this.router.navigate([link.path], { queryParams: link.query });
  }

  private nearestSeries(event: ChartEvent | undefined, active: { datasetIndex: number }[]): number {
    const y = event?.y;
    if (y === undefined || y === null) return active[0].datasetIndex;
    let best = active[0] as { datasetIndex: number; element?: { y: number } };
    for (const candidate of active as { datasetIndex: number; element?: { y: number } }[]) {
      if (Math.abs((candidate.element?.y ?? 0) - y) < Math.abs((best.element?.y ?? 0) - y))
        best = candidate;
    }
    return best.datasetIndex;
  }

  private readPalette(): Palette {
    const style = getComputedStyle(this.document.documentElement);
    const token = (name: string) => style.getPropertyValue(`--tk-${name}`).trim();
    return {
      created: token('palette-0'),
      resolved: token('category-done'),
      grid: token('border-subtle'),
      tick: token('text-subtle'),
      surface: token('surface'),
      raised: token('surface-raised'),
      border: token('border'),
      text: token('text'),
      muted: token('text-muted'),
      crosshair: token('border-strong'),
    };
  }
}
