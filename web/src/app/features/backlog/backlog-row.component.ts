import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  viewChild,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { BacklogItem, BacklogParent, UserRef } from '@core/tickets/ticket.models';
import {
  Priority,
  PRIORITY_LABELS,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
  TicketStatus,
  TicketType,
} from '@shared/domain/enums';
import {
  PRIORITY_OPTIONS,
  STORY_POINT_OPTIONS,
  TICKET_STATUS_OPTIONS,
  TICKET_TYPE_OPTIONS,
} from '@shared/domain/picker-options';
import { RelativeTimePipe, AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { AvatarComponent } from '@shared/ui/domain/avatar.component';
import { SeverityBadgeComponent } from '@shared/ui/domain/domain-badges';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { LabelsPickerDirective } from '@shared/ui/labels-picker/labels-picker.directive';
import { LabelToggle } from '@shared/ui/labels-picker/labels-picker-panel.component';
import { SearchFn, SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';

export type RowPicker = 'status' | 'priority' | 'type' | 'assignee' | 'labels';

export type RowEdit =
  | { field: 'status'; value: TicketStatus }
  | { field: 'priority'; value: Priority }
  | { field: 'type'; value: TicketType }
  | { field: 'storyPoints'; value: number | null }
  | { field: 'assignee'; value: UserRef | null }
  | { field: 'label'; value: LabelToggle };

/// One dense backlog row (backlog.html): checkbox, priority, key, type, status, title, severity,
/// parent chip, labels, counts, points, version, assignee and updated date. Status, priority,
/// points, assignee and labels open inline pickers without opening the ticket.
@Component({
  selector: 'tk-backlog-row',
  imports: [
    MatTooltip,
    RelativeTimePipe,
    AbsoluteTimePipe,
    AvatarComponent,
    SeverityBadgeComponent,
    LabelChipComponent,
    PriorityIconComponent,
    StatusIconComponent,
    TypeIconComponent,
    IconComponent,
    InlinePickerDirective,
    LabelsPickerDirective,
    SearchPickerDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'row',
    '[class.sel]': 'selected()',
    '[class.focus]': 'focused()',
    '[class.flash]': 'flash()',
    '[class.done]': 'item().status === "Done"',
    '[class.pending]': 'pending()',
    '[attr.aria-busy]': 'pending() || null',
    '[attr.aria-selected]': 'selected()',
    '[attr.data-testid]': '"backlog-row-" + item().key',
  },
  template: `
    <span class="c-check" role="gridcell">
      <button
        type="button"
        class="cb"
        [class.on]="selected()"
        [attr.aria-label]="'Select ' + item().key"
        [attr.aria-pressed]="selected()"
        data-testid="row-checkbox"
        (click)="$event.stopPropagation(); toggleSelect.emit($event.shiftKey)"
      >
        @if (selected()) {
          <tk-icon name="tablerCheck" [size]="12" />
        }
      </button>
    </span>
    <button
      type="button"
      class="cell-btn"
      [disabled]="!canWrite()"
      #priorityPicker="tkInlinePicker"
      [tkInlinePicker]="priorityOptions"
      [pickerValue]="item().priority"
      pickerPlaceholder="Change priority…"
      pickerShortcut="P"
      [attr.aria-label]="'Priority: ' + priorityLabel()"
      data-testid="row-priority"
      (click)="$event.stopPropagation()"
      (picked)="edit.emit({ field: 'priority', value: $event })"
    >
      <tk-priority-icon [priority]="item().priority" />
    </button>
    <span class="key tnum">{{ pending() ? '…' : item().key }}</span>
    <button
      type="button"
      class="cell-btn"
      [disabled]="!canWrite()"
      #typePicker="tkInlinePicker"
      [tkInlinePicker]="typeOptions"
      [pickerValue]="item().type"
      pickerPlaceholder="Change type…"
      pickerShortcut="T"
      [attr.aria-label]="'Type: ' + typeLabel()"
      data-testid="row-type"
      (click)="$event.stopPropagation()"
      (picked)="edit.emit({ field: 'type', value: $event })"
    >
      <tk-type-icon [type]="item().type" [size]="14" />
    </button>
    <button
      type="button"
      class="cell-btn"
      [disabled]="!canWrite()"
      #statusPicker="tkInlinePicker"
      [tkInlinePicker]="statusOptions"
      [pickerValue]="item().status"
      pickerPlaceholder="Change status…"
      pickerShortcut="S"
      [attr.aria-label]="'Status: ' + statusLabel()"
      data-testid="row-status"
      (click)="$event.stopPropagation()"
      (picked)="edit.emit({ field: 'status', value: $event })"
    >
      <tk-status-icon [status]="item().status" />
    </button>
    <span class="title" data-testid="row-title">{{ item().title }}</span>
    @if (
      item().severity === 'Critical' || item().severity === 'Blocker' || item().severity === 'Major'
    ) {
      <tk-severity-badge [severity]="item().severity!" />
    }
    <span class="fill"></span>
    <span class="tags">
      @if (showParent() && parent(); as p) {
        <span class="parent" [matTooltip]="p.key + ' ' + p.title">
          <tk-type-icon [type]="p.type" [size]="12" />
          <span>{{ p.title }}</span>
        </span>
      }
      <button
        type="button"
        class="labels"
        [disabled]="!canWrite()"
        #labelsPicker="tkLabelsPicker"
        [tkLabelsPicker]="item().labels"
        [labelSuggestions]="labelSuggestions()"
        aria-label="Labels"
        data-testid="row-labels"
        (click)="$event.stopPropagation()"
        (labelToggled)="edit.emit({ field: 'label', value: $event })"
      >
        @for (label of shownLabels(); track label) {
          <tk-label-chip [label]="label" />
        }
        @if (item().labels.length > 2) {
          <span class="more">+{{ item().labels.length - 2 }}</span>
        }
      </button>
    </span>
    <span class="metas">
      @if (item().childCount > 0) {
        <span class="cnt" matTooltip="Sub-tickets done">
          <tk-icon name="tablerSubtask" [size]="12" />{{ item().childDoneCount }}/{{
            item().childCount
          }}
        </span>
      }
      @if (item().testCaseCount > 0) {
        <span class="cnt" matTooltip="Test cases"
          ><tk-icon name="tablerChecklist" [size]="12" />{{ item().testCaseCount }}</span
        >
      }
      @if (item().commentCount > 0) {
        <span class="cnt" matTooltip="Comments"
          ><tk-icon name="tablerMessage" [size]="12" />{{ item().commentCount }}</span
        >
      }
    </span>
    <button
      type="button"
      class="pslot cell-btn"
      [disabled]="!canWrite()"
      [tkInlinePicker]="pointOptions"
      [pickerValue]="item().storyPoints"
      pickerPlaceholder="Story points…"
      aria-label="Story points"
      data-testid="row-points"
      (click)="$event.stopPropagation()"
      (picked)="edit.emit({ field: 'storyPoints', value: $event })"
    >
      <span class="pts" [class.none]="item().storyPoints === null">{{
        item().storyPoints ?? '–'
      }}</span>
    </button>
    <span class="ver">{{ item().version }}</span>
    <button
      type="button"
      class="cell-btn"
      [disabled]="!canWrite()"
      #assigneePicker="tkSearchPicker"
      [tkSearchPicker]="assigneeSearch()"
      pickerPlaceholder="Assign to…"
      pickerShortcut="A"
      [attr.aria-label]="'Assignee: ' + (assignee()?.displayName ?? 'Unassigned')"
      data-testid="row-assignee"
      (click)="$event.stopPropagation()"
      (picked)="edit.emit({ field: 'assignee', value: $event })"
    >
      <tk-avatar [userId]="assignee()?.id" [name]="assignee()?.displayName" />
    </button>
    <span class="date" [title]="item().updatedAt | absoluteTime">{{
      item().updatedAt | relativeTime
    }}</span>
  `,
  styleUrl: './backlog-row.component.scss',
})
export class BacklogRowComponent {
  readonly item = input.required<BacklogItem>();
  readonly assignee = input<UserRef | null>(null);
  readonly parent = input<BacklogParent | null>(null);
  readonly selected = input(false);
  readonly focused = input(false);
  readonly flash = input(false);
  readonly canWrite = input(false);
  /// Quick-created and not confirmed by the server yet: no key, not editable.
  readonly pending = input(false);
  /// False when the list is grouped by epic, where the group header already names the parent.
  readonly showParent = input(true);
  readonly assigneeSearch = input<SearchFn<UserRef | null>>(() => Promise.resolve([]));
  readonly labelSuggestions = input<(prefix: string) => Promise<readonly string[]>>(() =>
    Promise.resolve([]),
  );

  readonly edit = output<RowEdit>();
  /// Checkbox click; true when Shift was held (select the range from the anchor).
  readonly toggleSelect = output<boolean>();

  private readonly statusPicker =
    viewChild.required<InlinePickerDirective<TicketStatus>>('statusPicker');
  private readonly priorityPicker =
    viewChild.required<InlinePickerDirective<Priority>>('priorityPicker');
  private readonly typePicker = viewChild.required<InlinePickerDirective<TicketType>>('typePicker');
  private readonly assigneePicker =
    viewChild.required<SearchPickerDirective<UserRef | null>>('assigneePicker');
  private readonly labelsPicker = viewChild.required<LabelsPickerDirective>('labelsPicker');

  protected readonly statusOptions = TICKET_STATUS_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly typeOptions = TICKET_TYPE_OPTIONS;
  protected readonly pointOptions = STORY_POINT_OPTIONS;
  protected readonly shownLabels = computed(() => this.item().labels.slice(0, 2));
  protected readonly statusLabel = computed(() => TICKET_STATUS_LABELS[this.item().status]);
  protected readonly priorityLabel = computed(() => PRIORITY_LABELS[this.item().priority]);
  protected readonly typeLabel = computed(() => TICKET_TYPE_LABELS[this.item().type]);

  /// Opens a field picker from the keyboard (s, p, t, a, l on the focused row).
  openPicker(field: RowPicker): void {
    if (!this.canWrite()) return;
    switch (field) {
      case 'status':
        return this.statusPicker().open();
      case 'priority':
        return this.priorityPicker().open();
      case 'type':
        return this.typePicker().open();
      case 'assignee':
        return this.assigneePicker().open();
      case 'labels':
        return this.labelsPicker().open();
    }
  }
}
