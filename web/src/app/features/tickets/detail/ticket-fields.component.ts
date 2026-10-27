import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { FieldHints } from '@core/tickets/field-hints';
import { ProjectPeople } from '@core/tickets/project-people';
import { Ticket, TicketPatch, TicketRef, UserRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import {
  Priority,
  PRIORITY_LABELS,
  RESOLUTION_LABELS,
  RESOLUTIONS,
  Resolution,
  SEVERITIES,
  SEVERITY_LABELS,
  Severity,
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
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { SeverityBadgeComponent } from '@shared/ui/domain/domain-badges';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { StatusIconComponent } from '@shared/ui/domain/status-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { LabelsPickerDirective } from '@shared/ui/labels-picker/labels-picker.directive';
import { LabelToggle } from '@shared/ui/labels-picker/labels-picker-panel.component';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import { firstValueFrom } from 'rxjs';

export interface FieldEdit {
  patch: TicketPatch;
  optimistic: Partial<Ticket>;
}

const SEVERITY_OPTIONS: PickerOption<Severity | null>[] = [
  { value: null, label: 'None', keywords: ['clear'] },
  ...SEVERITIES.map((s) => ({ value: s, label: SEVERITY_LABELS[s] })),
];
const RESOLUTION_OPTIONS: PickerOption<Resolution>[] = RESOLUTIONS.map((r) => ({
  value: r,
  label: RESOLUTION_LABELS[r],
}));

/// The ticket's property column (ticket-detail.html `dside`): every value is a ghost button that
/// opens an inline picker. Edits are emitted as PATCH + optimistic values.
@Component({
  selector: 'tk-ticket-fields',
  imports: [
    MatTooltip,
    AbsoluteTimePipe,
    RelativeTimePipe,
    SeverityBadgeComponent,
    LabelChipComponent,
    PriorityIconComponent,
    StatusIconComponent,
    TypeIconComponent,
    UserDisplayComponent,
    IconComponent,
    InlinePickerDirective,
    KbdComponent,
    LabelsPickerDirective,
    SearchPickerDirective,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.grid]': 'layout() === "grid"' },
  template: `
    @let t = ticket();
    @if (layout() === 'column' && canEdit()) {
      <div class="side-h">
        <button
          type="button"
          class="assign-me"
          data-testid="assign-to-me"
          (click)="assignToMe.emit()"
        >
          <tk-icon name="tablerUser" [size]="14" />Assign to me<tk-kbd>A</tk-kbd>
        </button>
      </div>
    }
    <div class="fgroup">
      <div class="field">
        <span class="fl">Status</span>
        <button
          type="button"
          class="fv"
          data-testid="field-status"
          [disabled]="!canEdit()"
          #statusPicker="tkInlinePicker"
          [tkInlinePicker]="statusOptions"
          [pickerValue]="t.status"
          pickerPlaceholder="Change status…"
          pickerShortcut="S"
          (picked)="setStatus($event)"
        >
          <tk-status-icon [status]="t.status" />{{ statusLabels[t.status] }}
        </button>
      </div>
      @if (t.status === 'Done') {
        <div class="field">
          <span class="fl">Resolution</span>
          <button
            type="button"
            class="fv"
            data-testid="field-resolution"
            [disabled]="!canEdit()"
            [tkInlinePicker]="resolutionOptions"
            [pickerValue]="t.resolution"
            pickerPlaceholder="Resolution…"
            (picked)="edit({ resolution: $event }, { resolution: $event })"
          >
            {{ t.resolution ? resolutionLabels[t.resolution] : 'Done' }}
          </button>
        </div>
      }
      <div class="field">
        <span class="fl">Priority</span>
        <button
          type="button"
          class="fv"
          data-testid="field-priority"
          [disabled]="!canEdit()"
          #priorityPicker="tkInlinePicker"
          [tkInlinePicker]="priorityOptions"
          [pickerValue]="t.priority"
          pickerPlaceholder="Change priority…"
          pickerShortcut="P"
          (picked)="edit({ priority: $event }, { priority: $event })"
        >
          <tk-priority-icon [priority]="t.priority" />{{ priorityLabels[t.priority] }}
        </button>
      </div>
      <div class="field">
        <span class="fl">Severity</span>
        <button
          type="button"
          class="fv"
          data-testid="field-severity"
          [disabled]="!canEdit()"
          [tkInlinePicker]="severityOptions"
          [pickerValue]="t.severity"
          pickerPlaceholder="Severity…"
          (picked)="edit({ severity: $event }, { severity: $event })"
        >
          @if (t.severity) {
            <tk-severity-badge [severity]="t.severity" />
          } @else {
            <span class="empty">None</span>
          }
        </button>
      </div>
      <div class="field">
        <span class="fl">Type</span>
        <button
          type="button"
          class="fv"
          data-testid="field-type"
          [disabled]="!canEdit()"
          [tkInlinePicker]="typeOptions"
          [pickerValue]="t.type"
          pickerPlaceholder="Change type…"
          (picked)="edit({ type: $event }, { type: $event })"
        >
          <tk-type-icon [type]="t.type" [showLabel]="true" />
        </button>
      </div>
    </div>
    <div class="fgroup">
      <div class="field">
        <span class="fl">Assignee</span>
        <button
          type="button"
          class="fv"
          data-testid="field-assignee"
          [disabled]="!canEdit()"
          #assigneePicker="tkSearchPicker"
          [tkSearchPicker]="assigneeSearch()"
          pickerPlaceholder="Assign to…"
          pickerShortcut="I"
          (picked)="setAssignee($event)"
        >
          <tk-user [user]="t.assignee" />
        </button>
      </div>
      <div class="field">
        <span class="fl">Reporter</span>
        <button
          type="button"
          class="fv"
          data-testid="field-reporter"
          [disabled]="!canEdit()"
          [tkSearchPicker]="reporterSearch()"
          pickerPlaceholder="Reporter…"
          (picked)="setReporter($event)"
        >
          <tk-user [user]="t.reporter" />
        </button>
      </div>
    </div>
    <div class="fgroup">
      <div class="field">
        <span class="fl">Story points</span>
        <button
          type="button"
          class="fv"
          data-testid="field-points"
          [disabled]="!canEdit()"
          [tkInlinePicker]="pointOptions"
          [pickerValue]="t.storyPoints"
          pickerPlaceholder="Story points…"
          (picked)="edit({ storyPoints: $event }, { storyPoints: $event })"
        >
          @if (t.storyPoints !== null) {
            <span class="pts">{{ t.storyPoints }}</span>
          } @else {
            <span class="empty">None</span>
          }
        </button>
      </div>
      <div class="field">
        <span class="fl">Version</span>
        <button
          type="button"
          class="fv"
          data-testid="field-version"
          [disabled]="!canEdit()"
          [tkSearchPicker]="versionSearch()"
          pickerPlaceholder="Version, for example 2.4.0"
          (picked)="edit({ version: $event }, { version: $event })"
        >
          @if (t.version) {
            <span class="tnum">{{ t.version }}</span>
          } @else {
            <span class="empty">None</span>
          }
        </button>
      </div>
      <div class="field">
        <span class="fl">Labels</span>
        <button
          type="button"
          class="fv wrap"
          data-testid="field-labels"
          [disabled]="!canEdit()"
          [tkLabelsPicker]="t.labels"
          [labelSuggestions]="labelSuggestions()"
          (labelToggled)="toggleLabel($event)"
        >
          @for (label of t.labels; track label) {
            <tk-label-chip [label]="label" />
          } @empty {
            <span class="empty">None</span>
          }
          @if (canEdit()) {
            <tk-icon class="add" name="tablerPlus" [size]="12" />
          }
        </button>
      </div>
    </div>
    <div class="fgroup">
      <div class="field">
        <span class="fl">Parent</span>
        <button
          type="button"
          class="fv nowrap"
          data-testid="field-parent"
          [disabled]="!canEdit() || t.type === 'Epic'"
          [matTooltip]="t.type === 'Epic' ? 'An Epic cannot have a parent' : ''"
          [tkSearchPicker]="parentSearch()"
          pickerPlaceholder="Search tickets by key or title…"
          (picked)="setParent($event)"
        >
          @if (t.parent; as parent) {
            <tk-type-icon [type]="parent.type" [size]="14" />
            <span class="tnum">{{ parent.key }}</span>
            <span class="sub">{{ parent.title }}</span>
          } @else {
            <span class="empty">None</span>
          }
        </button>
      </div>
      <div class="field">
        <span class="fl">Location</span>
        <span class="fv plain" data-testid="field-location">
          <tk-icon
            [name]="t.location.kind === 'Backlog' ? 'tablerList' : 'tablerLayoutKanban'"
            [size]="14"
          />
          {{ t.location.kind === 'Backlog' ? 'Backlog' : t.location.boardName }}
        </span>
      </div>
    </div>
    <div class="fgroup">
      <div class="field">
        <span class="fl">Created</span>
        <span class="fv plain" [title]="t.createdAt | absoluteTime">{{
          t.createdAt | relativeTime
        }}</span>
      </div>
      <div class="field">
        <span class="fl">Updated</span>
        <span class="fv plain" [title]="t.updatedAt | absoluteTime">{{
          t.updatedAt | relativeTime
        }}</span>
      </div>
      @if (t.resolvedAt) {
        <div class="field">
          <span class="fl">Resolved</span>
          <span class="fv plain" [title]="t.resolvedAt | absoluteTime">{{
            t.resolvedAt | relativeTime
          }}</span>
        </div>
      }
    </div>
  `,
  styleUrl: './ticket-fields.component.scss',
})
export class TicketFieldsComponent {
  private readonly api = inject(TicketsApi);
  private readonly hints = inject(FieldHints);
  private readonly people = inject(ProjectPeople);

  readonly ticket = input.required<Ticket>();
  readonly canEdit = input(false);
  readonly layout = input<'column' | 'grid'>('column');

  readonly changed = output<FieldEdit>();
  readonly assignToMe = output<void>();

  protected readonly statusOptions = TICKET_STATUS_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly typeOptions = TICKET_TYPE_OPTIONS;
  protected readonly pointOptions = STORY_POINT_OPTIONS;
  protected readonly severityOptions = SEVERITY_OPTIONS;
  protected readonly resolutionOptions = RESOLUTION_OPTIONS;
  protected readonly statusLabels: Record<TicketStatus, string> = TICKET_STATUS_LABELS;
  protected readonly priorityLabels: Record<Priority, string> = PRIORITY_LABELS;
  protected readonly typeLabels: Record<TicketType, string> = TICKET_TYPE_LABELS;
  protected readonly resolutionLabels = RESOLUTION_LABELS;

  private readonly statusPicker =
    viewChild.required<InlinePickerDirective<TicketStatus>>('statusPicker');
  private readonly priorityPicker =
    viewChild.required<InlinePickerDirective<Priority>>('priorityPicker');
  private readonly assigneePicker =
    viewChild.required<SearchPickerDirective<UserRef | null>>('assigneePicker');

  protected readonly assigneeSearch = computed(() => {
    const projectKey = this.ticket().projectKey;
    return this.people.picker(() => projectKey);
  });
  protected readonly reporterSearch = computed(() => {
    const projectKey = this.ticket().projectKey;
    return this.people.picker(() => projectKey, false);
  });

  protected readonly labelSuggestions = computed(() => {
    const projectKey = this.ticket().projectKey;
    return (prefix: string) => this.hints.get(projectKey, 'labels', prefix);
  });

  protected readonly versionSearch = computed(() => {
    const projectKey = this.ticket().projectKey;
    return async (query: string): Promise<PickerOption<string | null>[]> => {
      const versions = await this.hints.get(projectKey, 'version', query);
      const options: PickerOption<string | null>[] = versions.map((v) => ({ value: v, label: v }));
      if (query && !versions.includes(query))
        options.unshift({ value: query, label: `Use "${query}"` });
      options.push({ value: null, label: 'No version' });
      return options;
    };
  });

  protected readonly parentSearch = computed(() => {
    const t = this.ticket();
    return async (query: string): Promise<PickerOption<TicketRef | null>[]> => {
      const tickets = await firstValueFrom(this.api.find(t.projectKey, query));
      const options: PickerOption<TicketRef | null>[] = tickets
        .filter((x) => x.id !== t.id)
        .map((x) => ({ value: x, label: `${x.key} ${x.title}` }));
      if (t.parent) options.unshift({ value: null, label: 'Remove parent' });
      return options;
    };
  });

  /// Opens a field picker from the keyboard (s, p, i in the ticket view).
  openPicker(field: 'status' | 'priority' | 'assignee'): void {
    if (!this.canEdit()) return;
    if (field === 'status') this.statusPicker().open();
    else if (field === 'priority') this.priorityPicker().open();
    else this.assigneePicker().open();
  }

  protected edit(patch: TicketPatch, optimistic: Partial<Ticket>): void {
    this.changed.emit({ patch, optimistic });
  }

  protected setStatus(status: TicketStatus): void {
    const current = this.ticket();
    const resolution = status === 'Done' ? (current.resolution ?? 'Done') : null;
    this.edit({ status }, { status, resolution });
  }

  protected setAssignee(user: UserRef | null): void {
    if (user?.id === this.ticket().assignee?.id) return;
    this.edit({ assignee: user?.id ?? null }, { assignee: user });
  }

  protected setReporter(user: UserRef | null): void {
    if (user && user.id !== this.ticket().reporter.id)
      this.edit({ reporter: user.id }, { reporter: user });
  }

  protected toggleLabel(toggle: LabelToggle): void {
    const labels = this.ticket().labels;
    const next = toggle.add
      ? [...new Set([...labels, toggle.label])].sort()
      : labels.filter((l) => l !== toggle.label);
    this.edit(toggle.add ? { addLabels: [toggle.label] } : { removeLabels: [toggle.label] }, {
      labels: next,
    });
  }

  protected setParent(parent: TicketRef | null): void {
    this.edit({ parentKey: parent?.key ?? null }, { parent });
  }
}
