import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { BoardProject } from '@core/boards/board.models';
import { UserRef } from '@core/tickets/ticket.models';
import { TICKET_TYPES, TicketType } from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { ProjectTileComponent } from '@shared/ui/domain/project-tile.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { BoardFilters, EMPTY_FILTERS, hasActiveFilters, UNASSIGNED } from './board-logic';

type ListField = 'assignees' | 'types' | 'labels' | 'projects';

/// Board quick filters (I-29): only mine, assignee, type, label and project chips plus a title/key filter (`/`).
@Component({
  selector: 'tk-board-filters',
  imports: [
    MatMenuModule,
    AvatarComponent,
    LabelChipComponent,
    ProjectTileComponent,
    TypeIconComponent,
    IconComponent,
    KbdComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      class="fchip"
      [class.on]="filters().mine"
      [attr.aria-pressed]="filters().mine"
      data-testid="filter-mine"
      (click)="emit({ mine: !filters().mine })"
    >
      <tk-icon name="tablerUser" [size]="14" />Only mine
    </button>

    <button
      type="button"
      class="fchip"
      [class.on]="filters().assignees.length"
      [matMenuTriggerFor]="assigneeMenu"
      data-testid="filter-assignee"
    >
      @if (filters().assignees.length) {
        Assignee: <span class="n">{{ filters().assignees.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Assignee
      }
    </button>
    <mat-menu #assigneeMenu="matMenu" class="tk-filter-menu">
      <button
        mat-menu-item
        type="button"
        (click)="$event.stopPropagation(); toggle('assignees', unassigned)"
      >
        <span class="opt"
          ><span class="box" [class.on]="filters().assignees.includes(unassigned)"></span
          >Unassigned</span
        >
      </button>
      @for (user of users(); track user.id) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('assignees', user.id)"
        >
          <span class="opt">
            <span class="box" [class.on]="filters().assignees.includes(user.id)"></span>
            <tk-avatar [userId]="user.id" [name]="user.displayName" />{{ user.displayName }}
          </span>
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="filters().types.length"
      [matMenuTriggerFor]="typeMenu"
      data-testid="filter-type"
    >
      @if (filters().types.length) {
        Type: <span class="n">{{ filters().types.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Type
      }
    </button>
    <mat-menu #typeMenu="matMenu" class="tk-filter-menu">
      @for (type of types; track type) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('types', type)"
        >
          <span class="opt"
            ><span class="box" [class.on]="filters().types.includes(type)"></span
            ><tk-type-icon [type]="type" [size]="14" [showLabel]="true"
          /></span>
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="filters().labels.length"
      [matMenuTriggerFor]="labelMenu"
      data-testid="filter-labels"
    >
      @if (filters().labels.length) {
        Labels: <span class="n">{{ filters().labels.length }}</span>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Labels
      }
    </button>
    <mat-menu #labelMenu="matMenu" class="tk-filter-menu">
      @for (label of labels(); track label) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('labels', label)"
        >
          <span class="opt"
            ><span class="box" [class.on]="filters().labels.includes(label)"></span
            ><tk-label-chip [label]="label"
          /></span>
        </button>
      } @empty {
        <div class="empty">No labels on this board</div>
      }
    </mat-menu>

    @if (projects().length > 1) {
      <button
        type="button"
        class="fchip"
        [class.on]="filters().projects.length"
        [matMenuTriggerFor]="projectMenu"
        data-testid="filter-project"
      >
        @if (filters().projects.length) {
          Project: <span class="n">{{ filters().projects.length }}</span>
        } @else {
          <tk-icon name="tablerPlus" [size]="14" />Project
        }
      </button>
      <mat-menu #projectMenu="matMenu" class="tk-filter-menu">
        @for (project of projects(); track project.id) {
          <button
            mat-menu-item
            type="button"
            (click)="$event.stopPropagation(); toggle('projects', project.key)"
          >
            <span class="opt">
              <span class="box" [class.on]="filters().projects.includes(project.key)"></span>
              <tk-project-tile [projectKey]="project.key" />{{ project.name }}
            </span>
          </button>
        }
      </mat-menu>
    }

    <span class="vsep"></span>
    <label class="finput">
      <tk-icon name="tablerSearch" [size]="14" />
      <input
        #text
        type="search"
        placeholder="Filter cards"
        aria-label="Filter cards by title or key"
        data-testid="board-filter-text"
        [value]="filters().text"
        (input)="emit({ text: text.value })"
        (keydown.escape)="text.blur()"
      />
      @if (!filters().text) {
        <tk-kbd>/</tk-kbd>
      }
    </label>
    @if (active()) {
      <button
        type="button"
        class="clear"
        data-testid="filters-clear"
        (click)="filtersChange.emit(empty)"
      >
        Clear
      </button>
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
      width: 200px;
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
export class BoardFiltersComponent {
  readonly filters = input.required<BoardFilters>();
  readonly users = input<readonly UserRef[]>([]);
  readonly labels = input<readonly string[]>([]);
  readonly projects = input<readonly BoardProject[]>([]);
  readonly filtersChange = output<BoardFilters>();

  protected readonly types = TICKET_TYPES;
  protected readonly unassigned = UNASSIGNED;
  protected readonly empty = EMPTY_FILTERS;
  protected readonly active = computed(() => hasActiveFilters(this.filters()));

  private readonly text = viewChild.required<ElementRef<HTMLInputElement>>('text');

  focusText(): void {
    this.text().nativeElement.focus();
    this.text().nativeElement.select();
  }

  protected emit(change: Partial<BoardFilters>): void {
    this.filtersChange.emit({ ...this.filters(), ...change });
  }

  protected toggle(field: ListField, value: TicketType | string): void {
    const current = this.filters()[field] as string[];
    const next = current.includes(value) ? current.filter((v) => v !== value) : [...current, value];
    this.emit({ [field]: next });
  }
}
