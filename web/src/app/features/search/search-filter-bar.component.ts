import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { MatMenuModule } from '@angular/material/menu';
import { ApiClient } from '@core/api/api-client';
import { UserRef } from '@core/tickets/ticket.models';
import {
  PRIORITIES,
  PRIORITY_LABELS,
  SEVERITIES,
  SEVERITY_LABELS,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_TYPES,
} from '@shared/domain/enums';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  DATE_PRESETS,
  DatePreset,
  EMPTY_SEARCH,
  hasFilters,
  ListField,
  rangeLabel,
  SearchFilters,
  TextField,
  toggleValue,
  utcDate,
} from './search-query';
import { ProjectFacetComponent } from './project-facet.component';

interface ExtraChip {
  id: string;
  label: string;
  clear: Partial<SearchFilters>;
}

/// The search filter chips (spec 6.8): one dashed "add" chip per filter that turns solid with a
/// summary when active, each a menu; filters that only arrive through links (parent, reporter,
/// resolved range, regression bugs, excluded assignees) show as removable chips.
@Component({
  selector: 'tk-search-filter-bar',
  imports: [
    MatMenuModule,
    AvatarComponent,
    LabelChipComponent,
    PriorityIconComponent,
    ProjectFacetComponent,
    StatusIconComponent,
    TypeIconComponent,
    IconComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'toolbar', 'aria-label': 'Filters' },
  styleUrl: './filter-chips.scss',
  styles: `
    :host {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
    }
  `,
  template: `
    <tk-project-facet
      testId="filter-project"
      [selected]="f().project"
      (toggled)="toggle('project', $event)"
    />

    <button
      type="button"
      class="fchip"
      [class.on]="f().type.length"
      [matMenuTriggerFor]="typeMenu"
      data-testid="filter-type"
    >
      @if (f().type.length) {
        Type: <b>{{ f().type.length === 1 ? f().type[0] : f().type.length }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Type
      }
    </button>
    <mat-menu #typeMenu="matMenu" class="tk-filter-menu">
      @for (type of types; track type) {
        <button
          mat-menu-item
          type="button"
          [attr.data-testid]="'filter-type-' + type"
          (click)="$event.stopPropagation(); toggle('type', type)"
        >
          <span class="opt"
            ><span class="box" [class.on]="f().type.includes(type)"></span
            ><tk-type-icon [type]="type" [size]="14" [showLabel]="true"
          /></span>
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().status.length || f().category.length"
      [matMenuTriggerFor]="statusMenu"
      data-testid="filter-status"
    >
      @if (f().status.length || f().category.length) {
        Status: <b>{{ statusSummary() }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Status
      }
    </button>
    <mat-menu #statusMenu="matMenu" class="tk-filter-menu">
      <div class="mhead">Category</div>
      @for (category of categories; track category) {
        <button
          mat-menu-item
          type="button"
          [attr.data-testid]="'filter-category-' + category"
          (click)="$event.stopPropagation(); toggle('category', category)"
        >
          <span class="opt"
            ><span class="box" [class.on]="f().category.includes(category)"></span
            >{{ categoryLabels[category] }}</span
          >
        </button>
      }
      <div class="mhead">Status</div>
      @for (status of statuses; track status) {
        <button
          mat-menu-item
          type="button"
          [attr.data-testid]="'filter-status-' + status"
          (click)="$event.stopPropagation(); toggle('status', status)"
        >
          <span class="opt"
            ><span class="box" [class.on]="f().status.includes(status)"></span
            ><tk-status-icon [status]="status" />{{ statusLabels[status] }}</span
          >
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().priority.length"
      [matMenuTriggerFor]="priorityMenu"
      data-testid="filter-priority"
    >
      @if (f().priority.length) {
        Priority: <b>{{ f().priority.length === 1 ? f().priority[0] : f().priority.length }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Priority
      }
    </button>
    <mat-menu #priorityMenu="matMenu" class="tk-filter-menu">
      @for (priority of priorities; track priority) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('priority', priority)"
        >
          <span class="opt"
            ><span class="box" [class.on]="f().priority.includes(priority)"></span
            ><tk-priority-icon [priority]="priority" />{{ priorityLabels[priority] }}</span
          >
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().severity.length"
      [matMenuTriggerFor]="severityMenu"
      data-testid="filter-severity"
    >
      @if (f().severity.length) {
        Severity: <b>{{ f().severity.length === 1 ? f().severity[0] : f().severity.length }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Severity
      }
    </button>
    <mat-menu #severityMenu="matMenu" class="tk-filter-menu">
      @for (severity of severities; track severity) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('severity', severity)"
        >
          <span class="opt"
            ><span class="box" [class.on]="f().severity.includes(severity)"></span
            >{{ severityLabels[severity] }}</span
          >
        </button>
      }
      <button
        mat-menu-item
        type="button"
        (click)="$event.stopPropagation(); toggle('severity', 'none')"
      >
        <span class="opt"
          ><span class="box" [class.on]="f().severity.includes('none')"></span>No severity</span
        >
      </button>
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().assignee.length"
      [matMenuTriggerFor]="assigneeMenu"
      data-testid="filter-assignee"
      (menuOpened)="focusInput(userInput)"
    >
      @if (f().assignee.length) {
        Assignee: <b>{{ assigneeSummary() }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Assignee
      }
    </button>
    <mat-menu #assigneeMenu="matMenu" class="tk-filter-menu">
      <div class="minput">
        <input
          #userInput
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          placeholder="Find people…"
          aria-label="Find people"
          data-testid="filter-assignee-input"
          (input)="findUsers(userInput.value)"
        />
      </div>
      <button
        mat-menu-item
        type="button"
        data-testid="filter-assignee-me"
        (click)="$event.stopPropagation(); toggle('assignee', 'me')"
      >
        <span class="opt"
          ><span class="box" [class.on]="f().assignee.includes('me')"></span>Me</span
        >
      </button>
      <button
        mat-menu-item
        type="button"
        (click)="$event.stopPropagation(); toggle('assignee', 'unassigned')"
      >
        <span class="opt"
          ><span class="box" [class.on]="f().assignee.includes('unassigned')"></span
          ><tk-avatar />Unassigned</span
        >
      </button>
      @for (user of userOptions(); track user.id) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('assignee', user.id)"
        >
          <span class="opt"
            ><span class="box" [class.on]="f().assignee.includes(user.id)"></span
            ><tk-avatar [userId]="user.id" [name]="user.displayName" />{{ user.displayName }}</span
          >
        </button>
      }
    </mat-menu>

    <button
      type="button"
      class="fchip"
      data-testid="filter-watching"
      [class.on]="f().watching"
      [attr.aria-pressed]="f().watching"
      (click)="patch({ watching: !f().watching })"
    >
      <tk-icon name="tablerEye" [size]="14" />Watching
    </button>

    <button
      type="button"
      class="fchip"
      [class.on]="f().label.length"
      [matMenuTriggerFor]="labelMenu"
      data-testid="filter-label"
      (menuOpened)="focusInput(labelInput)"
    >
      @if (f().label.length) {
        Labels: <b>{{ summary(f().label) }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Labels
      }
    </button>
    <mat-menu #labelMenu="matMenu" class="tk-filter-menu">
      <div class="minput">
        <input
          #labelInput
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          placeholder="Add label, Enter"
          aria-label="Label"
          data-testid="filter-label-input"
          (keydown.enter)="addLabel(labelInput)"
        />
      </div>
      @for (label of f().label; track label) {
        <button
          mat-menu-item
          type="button"
          (click)="$event.stopPropagation(); toggle('label', label)"
        >
          <span class="opt"><span class="box on"></span><tk-label-chip [label]="label" /></span>
        </button>
      }
      <div class="mnote">Tickets must have all selected labels.</div>
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().version"
      [matMenuTriggerFor]="versionMenu"
      data-testid="filter-version"
      (menuOpened)="focusInput(versionInput)"
    >
      @if (f().version) {
        Version: <b>{{ f().version === 'none' ? 'none' : f().version }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Version
      }
    </button>
    <mat-menu #versionMenu="matMenu" class="tk-filter-menu">
      <div class="minput">
        <input
          #versionInput
          (click)="$event.stopPropagation()"
          (keydown)="$event.stopPropagation()"
          placeholder="Exact version, Enter"
          aria-label="Version"
          [value]="f().version === 'none' ? '' : f().version"
          (keydown.enter)="setText('version', versionInput.value); versionInput.blur()"
        />
      </div>
      <button mat-menu-item type="button" (click)="setText('version', 'none')">No version</button>
      <button mat-menu-item type="button" (click)="setText('version', '')">Any version</button>
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().location"
      [matMenuTriggerFor]="locationMenu"
      data-testid="filter-location"
    >
      @if (f().location) {
        Location: <b>{{ locationLabel() }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Location
      }
    </button>
    <mat-menu #locationMenu="matMenu" class="tk-filter-menu">
      <button mat-menu-item type="button" (click)="setText('location', '')">Anywhere</button>
      <button mat-menu-item type="button" (click)="setText('location', 'backlog')">
        In a backlog
      </button>
      <button mat-menu-item type="button" (click)="setText('location', 'board')">On a board</button>
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().updatedFrom || f().updatedTo"
      [matMenuTriggerFor]="updatedMenu"
      data-testid="filter-updated"
    >
      @if (f().updatedFrom || f().updatedTo) {
        Updated: <b>{{ rangeLabel(f().updatedFrom, f().updatedTo) }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Updated
      }
    </button>
    <mat-menu #updatedMenu="matMenu" class="tk-filter-menu">
      @for (preset of presets; track preset.label) {
        <button mat-menu-item type="button" (click)="setRange('updated', preset)">
          {{ preset.label }}
        </button>
      }
      <button mat-menu-item type="button" (click)="setRange('updated', null)">Any time</button>
    </mat-menu>

    <button
      type="button"
      class="fchip"
      [class.on]="f().createdFrom || f().createdTo"
      [matMenuTriggerFor]="createdMenu"
      data-testid="filter-created"
    >
      @if (f().createdFrom || f().createdTo) {
        Created: <b>{{ rangeLabel(f().createdFrom, f().createdTo) }}</b>
      } @else {
        <tk-icon name="tablerPlus" [size]="14" />Created
      }
    </button>
    <mat-menu #createdMenu="matMenu" class="tk-filter-menu">
      @for (preset of presets; track preset.label) {
        <button mat-menu-item type="button" (click)="setRange('created', preset)">
          {{ preset.label }}
        </button>
      }
      <button mat-menu-item type="button" (click)="setRange('created', null)">Any time</button>
    </mat-menu>

    @for (chip of extraChips(); track chip.id) {
      <span class="fchip on fixed" [attr.data-testid]="'filter-extra-' + chip.id">
        {{ chip.label }}
        <button
          type="button"
          class="x"
          [attr.aria-label]="'Remove ' + chip.label"
          (click)="patch(chip.clear)"
        >
          <tk-icon name="tablerX" [size]="12" />
        </button>
      </span>
    }

    @if (active()) {
      <button type="button" class="clear" data-testid="filters-clear" (click)="clear()">
        Clear
      </button>
    }
  `,
})
export class SearchFilterBarComponent {
  private readonly api = inject(ApiClient);

  readonly filters = input.required<SearchFilters>();
  /// People to offer in the assignee menu (besides Me and Unassigned), for example the assignees in the results.
  readonly users = input<readonly UserRef[]>([]);
  readonly filtersChange = output<SearchFilters>();

  protected readonly f = this.filters;
  protected readonly types = TICKET_TYPES;
  protected readonly statuses = TICKET_STATUSES;
  protected readonly categories = STATUS_CATEGORIES;
  protected readonly priorities = PRIORITIES;
  protected readonly severities = SEVERITIES;
  protected readonly statusLabels = TICKET_STATUS_LABELS;
  protected readonly categoryLabels = STATUS_CATEGORY_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly severityLabels = SEVERITY_LABELS;
  protected readonly presets = DATE_PRESETS;

  protected readonly active = computed(() => hasFilters({ ...this.f(), q: '' }));

  protected readonly statusSummary = computed(() => {
    const { status, category } = this.f();
    if (
      status.length === 0 &&
      category.length === 2 &&
      category.includes('ToDo') &&
      category.includes('InProgress')
    )
      return 'Open';
    const parts = [
      ...category.map((c) => STATUS_CATEGORY_LABELS[c as keyof typeof STATUS_CATEGORY_LABELS] ?? c),
      ...status.map((s) => TICKET_STATUS_LABELS[s as keyof typeof TICKET_STATUS_LABELS] ?? s),
    ];
    return parts.length === 1 ? parts[0] : `${parts.length}`;
  });

  private readonly found = signal<readonly UserRef[] | null>(null);
  private readonly known = signal<ReadonlyMap<string, UserRef>>(new Map());
  private findTimer: ReturnType<typeof setTimeout> | null = null;

  /// Search results while typing, otherwise the people offered by the page plus selected ones.
  protected readonly userOptions = computed(() => {
    const found = this.found();
    if (found) return found;
    const selected = this.f()
      .assignee.map((id) => this.known().get(id))
      .filter((u): u is UserRef => !!u);
    const users = new Map([...selected, ...this.users()].map((u) => [u.id, u]));
    return [...users.values()];
  });

  protected readonly assigneeSummary = computed(() => {
    const values = this.f().assignee;
    if (values.length > 1) return `${values.length}`;
    const value = values[0];
    if (value === 'me') return 'Me';
    if (value === 'unassigned') return 'Unassigned';
    const user =
      this.known().get(value) ?? this.users().find((u) => u.id === value || u.email === value);
    return user?.displayName ?? value;
  });

  constructor() {
    effect(() => {
      const users = this.users();
      untracked(() => this.remember(users));
    });
    inject(DestroyRef).onDestroy(() => {
      if (this.findTimer) clearTimeout(this.findTimer);
    });
  }

  protected findUsers(query: string): void {
    if (this.findTimer) clearTimeout(this.findTimer);
    if (!query.trim()) {
      this.found.set(null);
      return;
    }
    this.findTimer = setTimeout(() => {
      this.api.get<UserRef[]>('/users', { query: query.trim(), includeInactive: true }).subscribe({
        next: (users) => {
          this.remember(users);
          this.found.set(users);
        },
        error: () => this.found.set([]),
      });
    }, 150);
  }

  private remember(users: readonly UserRef[]): void {
    if (!users.length) return;
    this.known.update((map) => new Map([...map, ...users.map((u) => [u.id, u] as const)]));
  }

  protected readonly locationLabel = computed(() => {
    const location = this.f().location;
    return location === 'backlog' ? 'Backlog' : location === 'board' ? 'Any board' : 'Board';
  });

  protected readonly extraChips = computed<ExtraChip[]>(() => {
    const f = this.f();
    const chips: ExtraChip[] = [];
    if (f.parent) chips.push({ id: 'parent', label: `Parent: ${f.parent}`, clear: { parent: '' } });
    if (f.reporter.length)
      chips.push({
        id: 'reporter',
        label: `Reporter: ${f.reporter.length === 1 ? (f.reporter[0] === 'me' ? 'Me' : f.reporter[0]) : f.reporter.length}`,
        clear: { reporter: [] },
      });
    if (f.assigneeNot.length)
      chips.push({
        id: 'assigneeNot',
        label: `Not assigned to ${f.assigneeNot.length}`,
        clear: { assigneeNot: [] },
      });
    if (f.resolvedFrom || f.resolvedTo)
      chips.push({
        id: 'resolved',
        label: `Resolved: ${this.rangeLabel(f.resolvedFrom, f.resolvedTo)}`,
        clear: { resolvedFrom: '', resolvedTo: '' },
      });
    if (f.fromRegression)
      chips.push({ id: 'regression', label: 'From regressions', clear: { fromRegression: false } });
    return chips;
  });

  protected summary(values: readonly string[]): string {
    return values.length <= 2 ? values.join(', ') : `${values.length}`;
  }

  protected toggle(field: ListField, value: string): void {
    this.filtersChange.emit(toggleValue(this.f(), field, value));
  }

  protected setText(field: TextField, value: string): void {
    this.patch({ [field]: value.trim() });
  }

  protected addLabel(input: HTMLInputElement): void {
    const labels = input.value
      .split(',')
      .map((l) => l.trim().toLowerCase())
      .filter(Boolean);
    input.value = '';
    if (labels.length) this.patch({ label: [...new Set([...this.f().label, ...labels])] });
  }

  protected setRange(field: 'updated' | 'created', preset: DatePreset | null): void {
    const now = new Date();
    this.patch({
      [`${field}From`]: preset?.from !== undefined ? utcDate(now, preset.from) : '',
      [`${field}To`]: preset?.to !== undefined ? utcDate(now, preset.to) : '',
    });
  }

  protected rangeLabel(from: string, to: string): string {
    return rangeLabel(from, to);
  }

  protected focusInput(input: HTMLInputElement): void {
    setTimeout(() => input.focus());
  }

  protected patch(change: Partial<SearchFilters>): void {
    this.filtersChange.emit({ ...this.f(), ...change });
  }

  protected clear(): void {
    this.filtersChange.emit({
      ...EMPTY_SEARCH,
      q: this.f().q,
      sort: this.f().sort,
      order: this.f().order,
    });
  }
}
