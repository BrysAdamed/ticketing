import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { Router, RouterLink } from '@angular/router';
import { PeekService } from '@core/layout/peek/peek';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { TicketCache } from '@core/tickets/ticket-cache';
import { EXECUTION_MODE_LABELS } from '@shared/domain/enums';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { TicketRowComponent } from '@shared/ui/ticket-row/ticket-row.component';
import { MyWorkStore, REGRESSIONS_GROUP } from './my-work.store';

/// My work (spec 6.8, I-08): open tickets assigned to me across projects, grouped by project and
/// ordered by priority, then my waiting regression items. `J`/`K` move, `Enter` opens.
@Component({
  selector: 'tk-my-work-view',
  imports: [MatButtonModule, RouterLink, ProjectTileComponent, EmptyStateComponent, IconComponent, SkeletonRowsComponent, TicketRowComponent],
  providers: [MyWorkStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-my-work.list' },
  template: `
    <header class="tk-page-header">
      <h1>My work</h1>
      @if (store.work(); as work) {
        <span class="tk-page-count" data-testid="my-work-count">{{ work.ticketCount + work.regressionItems.length }}</span>
      }
      <div class="tk-page-actions">
        <a mat-stroked-button routerLink="/search" [queryParams]="searchParams" data-testid="my-work-search">
          <tk-icon name="tablerSearch" [size]="14" />Open in search
        </a>
      </div>
    </header>

    @if (store.status() === 'error' && !store.work()) {
      <tk-empty-state icon="tablerAlertCircle" tone="danger" title="Couldn't load your work" [description]="store.error()?.title ?? null">
        <button mat-stroked-button type="button" (click)="store.load()">Retry</button>
      </tk-empty-state>
    } @else if (!store.work()) {
      <tk-skeleton-rows [count]="10" />
    } @else if (store.isEmpty()) {
      <tk-empty-state icon="tablerInbox" title="Nothing assigned to you" description="Open tickets assigned to you and your waiting regression tests show up here.">
        <a mat-stroked-button routerLink="/projects">Browse projects</a>
      </tk-empty-state>
    } @else {
      <div class="list" role="grid" aria-label="My work" data-testid="my-work-list">
        @for (group of store.projects(); track group.projectKey) {
          <div class="ghead" role="row" [attr.data-testid]="'my-work-group-' + group.projectKey">
            <button
              type="button"
              class="chev"
              [attr.aria-expanded]="!store.collapsed().has(group.projectKey)"
              [attr.aria-label]="(store.collapsed().has(group.projectKey) ? 'Expand ' : 'Collapse ') + group.projectName"
              (click)="store.toggle(group.projectKey)"
            >
              <tk-icon [name]="store.collapsed().has(group.projectKey) ? 'tablerChevronRight' : 'tablerChevronDown'" [size]="14" />
            </button>
            <tk-project-tile [projectKey]="group.projectKey" />
            <a class="glabel" [routerLink]="['/projects', group.projectKey, 'backlog']">{{ group.projectName }}</a>
            <span class="gcount tnum">{{ group.tickets.length }}</span>
          </div>
          @if (!store.collapsed().has(group.projectKey)) {
            @for (ticket of group.tickets; track ticket.id) {
              <tk-ticket-row
                testIdPrefix="my-work-row-"
                [ticket]="ticket"
                [focused]="focusedId() === ticket.id"
                (click)="openTicket(ticket.key, $event)"
                (mouseenter)="cache.prefetch(ticket.key)"
              />
            }
          }
        }

        @if (store.work()?.truncated) {
          <div class="more">
            Showing the first {{ store.work()?.ticketCount }} tickets.
            <a [routerLink]="'/search'" [queryParams]="searchParams">See all in search</a>
          </div>
        }

        @if (store.items().length) {
          <div class="ghead" role="row" data-testid="my-work-group-regressions">
            <button type="button" class="chev" [attr.aria-expanded]="!store.collapsed().has(regressions)" aria-label="Toggle regression items" (click)="store.toggle(regressions)">
              <tk-icon [name]="store.collapsed().has(regressions) ? 'tablerChevronRight' : 'tablerChevronDown'" [size]="14" />
            </button>
            <tk-icon name="tablerListCheck" [size]="14" />
            <span class="glabel">Regression tests waiting for me</span>
            <span class="gcount tnum">{{ store.items().length }}</span>
          </div>
          @if (!store.collapsed().has(regressions)) {
            @for (item of store.items(); track item.itemId) {
              <a
                class="irow"
                role="row"
                [class.focus]="focusedId() === item.itemId"
                [routerLink]="itemPath(item.url)"
                [queryParams]="itemQuery(item.url)"
                [attr.data-testid]="'my-work-item-' + item.testCaseKey"
              >
                <tk-icon name="tablerChecklist" [size]="14" />
                <span class="key tnum">{{ item.testCaseKey }}</span>
                <span class="title">{{ item.title }}</span>
                <span class="fill"></span>
                <span class="mode">{{ modeLabels[item.executionMode] }}</span>
                <span class="session">
                  <tk-project-tile [projectKey]="item.projectKey" />{{ item.sessionKey }} · {{ item.sessionName }}
                  @if (item.sessionVersion) {
                    · {{ item.sessionVersion }}
                  }
                </span>
              </a>
            }
          }
        }
      </div>
    }
  `,
  styleUrl: './my-work.view.scss',
})
export class MyWorkView {
  protected readonly store = inject(MyWorkStore);
  protected readonly cache = inject(TicketCache);
  private readonly peek = inject(PeekService);
  private readonly router = inject(Router);

  protected readonly regressions = REGRESSIONS_GROUP;
  protected readonly modeLabels = EXECUTION_MODE_LABELS;
  protected readonly searchParams = { assignee: 'me', category: 'ToDo,InProgress', sort: 'priority' };
  protected readonly focusedId = computed(() => {
    const entry = this.store.focused();
    return entry?.kind === 'ticket' ? entry.ticket.id : entry?.kind === 'item' ? entry.item.itemId : null;
  });

  constructor() {
    void this.store.load();
    inject(ShortcutService).registerScoped([
      { keys: 'j', section: 'My work', description: 'Next item', handler: () => this.store.move(1) },
      { keys: 'k', section: 'My work', description: 'Previous item', handler: () => this.store.move(-1) },
      { keys: 'arrowdown', description: 'Next item', handler: () => this.store.move(1), showInHelp: false },
      { keys: 'arrowup', description: 'Previous item', handler: () => this.store.move(-1), showInHelp: false },
      { keys: 'enter', section: 'My work', description: 'Open', handler: () => this.openFocused() },
    ]);
  }

  protected openTicket(key: string, event: MouseEvent): void {
    const index = this.store.entries().findIndex((e) => e.kind === 'ticket' && e.ticket.key === key);
    this.store.focusIndex.set(index);
    if (event.ctrlKey || event.metaKey || event.shiftKey) void this.router.navigate(['/tickets', key]);
    else this.peek.open(key);
  }

  protected itemPath(url: string): string {
    return url.split('?')[0];
  }

  protected itemQuery(url: string): Record<string, string> {
    return Object.fromEntries(new URLSearchParams(url.split('?')[1] ?? ''));
  }

  private openFocused(): void {
    const entry = this.store.focused();
    if (entry?.kind === 'ticket') this.peek.open(entry.ticket.key);
    else if (entry?.kind === 'item') void this.router.navigateByUrl(entry.item.url);
  }
}
