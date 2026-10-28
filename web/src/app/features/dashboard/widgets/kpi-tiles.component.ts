import { DecimalPipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TourAnchorDirective } from '@core/onboarding/engine/tour-anchor.directive';
import { DashboardLink, DashboardLinks } from '../dashboard-links';
import { ProjectDashboard } from '../dashboard.model';
import { percent } from '../dashboard-widgets';

interface Tile {
  id: string;
  label: string;
  value: number;
  context: string;
  link: DashboardLink;
}

/// Widget 1 (totals) as a row of stat tiles: label, value, one line of context. Each tile is
/// the link to the search that produces its number.
@Component({
  selector: 'tk-kpi-tiles',
  imports: [RouterLink, DecimalPipe, TourAnchorDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      @for (tile of tiles(); track tile.id) {
        <a
          class="tile"
          [tkTourAnchor]="$first ? 'dashboard.count-link' : null"
          [routerLink]="tile.link.path"
          [queryParams]="tile.link.query"
          [attr.data-testid]="'kpi-' + tile.id"
        >
          <span class="label">{{ tile.label }}</span>
          <span class="value" data-testid="kpi-value">{{ tile.value | number }}</span>
          <span class="context">{{ tile.context }}</span>
        </a>
      }
    } @else {
      @for (tile of placeholders; track tile) {
        <div class="tile" aria-hidden="true">
          <span class="bone short"></span>
          <span class="bone value"></span>
          <span class="bone"></span>
        </div>
      }
    }
  `,
  styles: `
    :host {
      display: grid;
      grid-template-columns: repeat(4, minmax(0, 1fr));
      gap: 16px;
    }
    @container dashboard (max-width: 760px) {
      :host {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }
    .tile {
      height: 88px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 2px;
      padding: 0 16px;
      background: var(--tk-surface);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-lg);
      color: inherit;
      text-decoration: none;
      transition: border-color var(--tk-duration-instant) var(--tk-ease-out);
    }
    a.tile:hover {
      border-color: var(--tk-border-strong);
    }
    a.tile:hover .value {
      color: var(--tk-accent-fg);
    }
    a.tile:focus-visible {
      outline: 2px solid var(--tk-focus);
      outline-offset: 2px;
    }
    .label {
      font-size: var(--tk-text-sm);
      color: var(--tk-text-muted);
    }
    .value {
      font-size: var(--tk-text-3xl);
      line-height: var(--tk-leading-3xl);
      font-weight: var(--tk-weight-semibold);
      letter-spacing: var(--tk-tracking-tight);
    }
    .context {
      font-size: var(--tk-text-xs);
      line-height: var(--tk-leading-xs);
      color: var(--tk-text-subtle);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .bone {
      display: block;
      height: 10px;
      width: 60%;
      border-radius: var(--tk-radius-sm);
      background: var(--tk-skeleton);
    }
    .bone.short {
      width: 40%;
    }
    .bone.value {
      height: 24px;
      width: 30%;
      margin: 4px 0;
    }
  `,
})
export class KpiTilesComponent {
  readonly data = input.required<ProjectDashboard | null>();
  readonly links = input.required<DashboardLinks>();

  protected readonly placeholders = [1, 2, 3, 4];

  protected readonly tiles = computed<Tile[]>(() => {
    const data = this.data();
    if (!data) return [];
    const links = this.links();
    const { openTickets, doneTickets, openStoryPoints, unassignedOpenTickets } = data.totals;
    const total = openTickets + doneTickets;
    const thisWeek = data.createdVsResolved.at(-1);
    const unassignedShare = percent(unassignedOpenTickets, openTickets);
    return [
      {
        id: 'open',
        label: 'Open tickets',
        value: openTickets,
        context:
          total === 0
            ? 'No tickets yet'
            : `${percent(openTickets, total)}% of ${total.toLocaleString('en')} tickets`,
        link: links.open(),
      },
      {
        id: 'done',
        label: 'Done tickets',
        value: doneTickets,
        context: `${thisWeek?.resolved ?? 0} resolved this week`,
        link: links.done(),
      },
      {
        id: 'points',
        label: 'Open story points',
        value: openStoryPoints,
        context: 'Sum of estimates on open tickets',
        link: links.open(),
      },
      {
        id: 'unassigned',
        label: 'Unassigned open',
        value: unassignedOpenTickets,
        context: unassignedShare === null ? 'Nothing open' : `${unassignedShare}% of open tickets`,
        link: links.unassignedOpen(),
      },
    ];
  });
}
