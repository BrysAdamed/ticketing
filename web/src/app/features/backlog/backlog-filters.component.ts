import { ChangeDetectionStrategy, Component, computed, ElementRef, input, output, signal, viewChild } from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { UserRef } from '@core/tickets/ticket.models';
import {
  Priority,
  PRIORITIES,
  PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  TicketStatus,
  TicketType,
} from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { BacklogFilters, EMPTY_FILTERS } from './backlog-logic';

/// Backlog toolbar filters (backlog.html): Type, Status, Priority, Assignee, Labels, Version chips,
/// each a menu; an active chip shows its count. Plus the title/key text filter (`/`).
@Component({
  selector: 'tk-backlog-filters',
  imports: [
    MatMenuModule,
    AvatarComponent,
    LabelChipComponent,
    PriorityIconComponent,
    StatusIconComponent,
    TypeIconComponent,
    IconComponent,
    KbdComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button type="button" class="fchip" [class.on]="filters().types.length" [matMenuTriggerFor]="typeMenu" data-testid="filter-type">
      @if (filters().types.length) {
        Type: <span class="n">{{ filters().types.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Type
      }
    </button>
    <mat-menu #typeMenu="matMenu" class="tk-filter-menu">
      @for (type of types; track type) {
        <button mat-menu-item type="button" (click)="$event.stopPropagation(); toggle('types', type)">
          <span class="opt"><span class="box" [class.on]="filters().types.includes(type)"></span><tk-type-icon [type]="type" [size]="14" [showLabel]="true" /></span>
        </button>
      }
    </mat-menu>

    <button type="button" class="fchip" [class.on]="filters().statuses.length" [matMenuTriggerFor]="statusMenu" data-testid="filter-status">
      @if (filters().statuses.length) {
        Status: <span class="n">{{ filters().statuses.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Status
      }
    </button>
    <mat-menu #statusMenu="matMenu" class="tk-filter-menu">
      @for (status of statuses; track status) {
        <button mat-menu-item type="button" (click)="$event.stopPropagation(); toggle('statuses', status)">
          <span class="opt"><span class="box" [class.on]="filters().statuses.includes(status)"></span><tk-status-icon [status]="status" />{{ statusLabels[status] }}</span>
        </button>
      }
    </mat-menu>

    <button type="button" class="fchip" [class.on]="filters().priorities.length" [matMenuTriggerFor]="priorityMenu" data-testid="filter-priority">
      @if (filters().priorities.length) {
        Priority: <span class="n">{{ filters().priorities.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Priority
      }
    </button>
    <mat-menu #priorityMenu="matMenu" class="tk-filter-menu">
      @for (priority of priorities; track priority) {
        <button mat-menu-item type="button" (click)="$event.stopPropagation(); toggle('priorities', priority)">
          <span class="opt"><span class="box" [class.on]="filters().priorities.includes(priority)"></span><tk-priority-icon [priority]="priority" />{{ priorityLabels[priority] }}</span>
        </button>
      }
    </mat-menu>

    <button type="button" class="fchip" [class.on]="filters().assignee" [matMenuTriggerFor]="assigneeMenu" data-testid="filter-assignee">
      @if (filters().assignee) {
        Assignee: <span class="n">{{ assigneeLabel() }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Assignee
      }
    </button>
    <mat-menu #assigneeMenu="matMenu" class="tk-filter-menu">
      <button mat-menu-item type="button" (click)="setAssignee(null)">Anyone</button>
      <button mat-menu-item type="button" (click)="setAssignee('me')">Assigned to me</button>
      <button mat-menu-item type="button" (click)="setAssignee('unassigned')">Unassigned</button>
      @for (user of users(); track user.id) {
        <button mat-menu-item type="button" (click)="setAssignee(user.id)">
          <span class="opt"><tk-avatar [userId]="user.id" [name]="user.displayName" />{{ user.displayName }}</span>
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="filters().labels.length"
      [matMenuTriggerFor]="labelMenu"
      data-testid="filter-labels"
      (menuOpened)="labelsOpened.emit()"
    >
      @if (filters().labels.length) {
        Labels: <span class="n">{{ filters().labels.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Labels
      }
    </button>
    <mat-menu #labelMenu="matMenu" class="tk-filter-menu">
      @for (label of labelOptions(); track label) {
        <button mat-menu-item type="button" (click)="$event.stopPropagation(); toggle('labels', label)">
          <span class="opt"><span class="box" [class.on]="filters().labels.includes(label)"></span><tk-label-chip [label]="label" /></span>
        </button>
      } @empty {
        <div class="empty">No labels used yet</div>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="filters().version"
      [matMenuTriggerFor]="versionMenu"
      data-testid="filter-version"
      (menuOpened)="versionsOpened.emit()"
    >
      @if (filters().version) {
        Version: <span class="n">{{ filters().version }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Version
      }
    </button>
    <mat-menu #versionMenu="matMenu" class="tk-filter-menu">
      <button mat-menu-item type="button" (click)="setVersion(null)">Any version</button>
      @for (version of versions(); track version) {
        <button mat-menu-item type="button" (click)="setVersion(version)">{{ version }}</button>
      }
    </mat-menu>

    <span class="vsep"></span>
    <label class="finput">
      <tk-icon name="tablerSearch" [size]="14" />
      <input
        #text
        type="search"
        placeholder="Filter by title or key"
        aria-label="Filter by title or key"
        data-testid="backlog-filter-text"
        [value]="filters().text"
        (input)="setText(text.value)"
        (keydown.escape)="text.blur()"
      />
      @if (!filters().text) {
        <tk-kbd>/</tk-kbd>
      }
    </label>
    @if (active()) {
      <button type="button" class="clear" data-testid="filters-clear" (click)="clear()">Clear</button>
    }
  `,
  styles: `
    :host {
      display: contents;
    }
    .fchip {
      height: 24px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 8px;
      border: 1px dashed var(--tk-border-strong);
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      font-weight: var(--tk-weight-medium);
      cursor: pointer;
      white-space: nowrap;
    }
    .fchip:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    .fchip.on {
      border-style: solid;
      border-color: var(--tk-accent-border);
      background: var(--tk-accent-subtle);
      color: var(--tk-accent-fg);
    }
    .n {
      font-variant-numeric: tabular-nums;
    }
    .vsep {
      width: 1px;
      height: 16px;
      background: var(--tk-border);
      margin: 0 4px;
    }
    .finput {
      height: 24px;
      width: 220px;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 0 6px 0 8px;
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      color: var(--tk-text-subtle);
      background: var(--tk-surface);
    }
    .finput:focus-within {
      border-color: var(--tk-accent);
    }
    .finput input {
      flex: 1;
      min-width: 0;
      border: 0;
      outline: 0;
      background: none;
      color: var(--tk-text);
      font: inherit;
      font-size: var(--tk-text-sm);
    }
    .clear {
      height: 24px;
      padding: 0 8px;
      border: 0;
      border-radius: var(--tk-radius-md);
      background: none;
      color: var(--tk-text-muted);
      font: inherit;
      font-size: var(--tk-text-sm);
      cursor: pointer;
    }
    .clear:hover {
      background: var(--tk-bg-hover);
      color: var(--tk-text);
    }
    .opt {
      display: inline-flex;
      align-items: center;
      gap: 8px;
    }
    .box {
      width: 14px;
      height: 14px;
      border: 1px solid var(--tk-border-input-hover);
      border-radius: var(--tk-radius-xs);
      flex: none;
    }
    .box.on {
      background: var(--tk-accent);
      border-color: var(--tk-accent);
      box-shadow: inset 0 0 0 2px var(--tk-surface-raised);
    }
    .empty {
      padding: 8px 12px;
      color: var(--tk-text-subtle);
    }
  `,
})
export class BacklogFiltersComponent {
  readonly filters = input.required<BacklogFilters>();
  readonly users = input<readonly UserRef[]>([]);
  readonly labelOptions = input<readonly string[]>([]);
  readonly versions = input<readonly string[]>([]);

  readonly filtersChange = output<BacklogFilters>();
  readonly labelsOpened = output<void>();
  readonly versionsOpened = output<void>();

  protected readonly types = TICKET_TYPES;
  protected readonly statuses = TICKET_STATUSES;
  protected readonly priorities = PRIORITIES;
  protected readonly typeLabels = TICKET_TYPE_LABELS;
  protected readonly statusLabels = TICKET_STATUS_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly active = computed(() => JSON.stringify({ ...this.filters(), showDone: false }) !== JSON.stringify(EMPTY_FILTERS));
  protected readonly assigneeLabel = computed(() => {
    const value = this.filters().assignee;
    if (value === 'me') return 'me';
    if (value === 'unassigned') return 'none';
    return this.users().find((u) => u.id === value)?.displayName ?? '1';
  });

  private readonly text = viewChild.required<ElementRef<HTMLInputElement>>('text');
  private readonly textDebounce = signal<ReturnType<typeof setTimeout> | null>(null);

  focusText(): void {
    this.text().nativeElement.focus();
    this.text().nativeElement.select();
  }

  protected toggle(field: 'types' | 'statuses' | 'priorities' | 'labels', value: TicketType | TicketStatus | Priority | string): void {
    const current = this.filters()[field] as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.filtersChange.emit({ ...this.filters(), [field]: next });
  }

  protected setAssignee(assignee: string | null): void {
    this.filtersChange.emit({ ...this.filters(), assignee });
  }

  protected setVersion(version: string | null): void {
    this.filtersChange.emit({ ...this.filters(), version });
  }

  protected setText(text: string): void {
    const pending = this.textDebounce();
    if (pending) clearTimeout(pending);
    this.textDebounce.set(setTimeout(() => this.filtersChange.emit({ ...this.filters(), text }), 200));
  }

  protected clear(): void {
    this.filtersChange.emit({ ...EMPTY_FILTERS, showDone: this.filters().showDone });
  }
}
