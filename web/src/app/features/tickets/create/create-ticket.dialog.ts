import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { provideIcons } from '@ng-icons/core';
import { firstValueFrom } from 'rxjs';
import { toApiError } from '@core/api/api-error';
import { PeekService } from '@core/layout/peek/peek';
import { ToastService } from '@core/notify/toast.service';
import { ProjectDirectory } from '@core/projects/project-directory';
import { CreateTicketPrefill } from '@core/tickets/create-ticket';
import { FieldHints } from '@core/tickets/field-hints';
import { ProjectPeople } from '@core/tickets/project-people';
import { TicketEvents } from '@core/tickets/ticket-events';
import { NewTicket, TicketRef, TicketSummary, UserRef } from '@core/tickets/ticket.models';
import { TicketsApi } from '@core/tickets/tickets.api';
import {
  Priority,
  PRIORITY_LABELS,
  Severity,
  SEVERITY_LABELS,
  TICKET_TYPE_LABELS,
  TicketType,
} from '@shared/domain/enums';
import {
  PRIORITY_OPTIONS,
  SEVERITY_OPTIONS,
  TICKET_TYPE_OPTIONS,
} from '@shared/domain/picker-options';
import { MarkdownEditorComponent } from '@shared/markdown/markdown-editor.component';
import { LabelChipComponent } from '@shared/ui/domain/label-chip.component';
import { PriorityIconComponent } from '@shared/ui/domain/priority-icon.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { InlinePickerDirective } from '@shared/ui/inline-picker/inline-picker.directive';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { LabelsPickerDirective } from '@shared/ui/labels-picker/labels-picker.directive';
import { LabelToggle } from '@shared/ui/labels-picker/labels-picker-panel.component';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import { TICKET_ICONS } from '../ticket-icons';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/// Create-ticket dialog (global `c`, top bar "New ticket", or `TicketCreator.open(prefill)` from other
/// features). The project is preselected from context; Ctrl/⌘+Enter creates.
@Component({
  selector: 'tk-create-ticket-dialog',
  imports: [
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MarkdownEditorComponent,
    LabelChipComponent,
    PriorityIconComponent,
    TypeIconComponent,
    UserDisplayComponent,
    IconComponent,
    InlinePickerDirective,
    KbdComponent,
    LabelsPickerDirective,
    SearchPickerDirective,
  ],
  viewProviders: [provideIcons(TICKET_ICONS)],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'create-ticket-dialog', '(keydown)': 'onKeydown($event)' },
  templateUrl: './create-ticket.dialog.html',
  styleUrl: './create-ticket.dialog.scss',
})
export class CreateTicketDialog {
  private readonly api = inject(TicketsApi);
  private readonly directory = inject(ProjectDirectory);
  private readonly people = inject(ProjectPeople);
  private readonly hints = inject(FieldHints);
  private readonly events = inject(TicketEvents);
  private readonly peek = inject(PeekService);
  private readonly toast = inject(ToastService);
  private readonly ref =
    inject<MatDialogRef<CreateTicketDialog, TicketSummary | null>>(MatDialogRef);
  protected readonly data = inject<CreateTicketPrefill>(MAT_DIALOG_DATA, { optional: true }) ?? {};

  protected readonly submitKeys = IS_MAC ? '⌘↵' : 'Ctrl ↵';
  protected readonly typeOptions = TICKET_TYPE_OPTIONS;
  protected readonly priorityOptions = PRIORITY_OPTIONS;
  protected readonly severityOptions: PickerOption<Severity | null>[] = [
    { value: null, label: 'None' },
    ...SEVERITY_OPTIONS,
  ];
  protected readonly typeLabels = TICKET_TYPE_LABELS;
  protected readonly priorityLabels = PRIORITY_LABELS;
  protected readonly severityLabels = SEVERITY_LABELS;

  protected readonly projects = computed(() =>
    this.directory.activeProjects().filter((p) => p.myRole !== 'Viewer'),
  );
  protected readonly projectKey = signal(this.data.projectKey ?? '');
  protected readonly title = signal(this.data.title ?? '');
  protected readonly type = signal<TicketType>(this.data.type ?? 'UserStory');
  protected readonly description = signal(this.data.description ?? '');
  protected readonly priority = signal<Priority>(this.data.priority ?? 'Medium');
  protected readonly severity = signal<Severity | null>(this.data.severity ?? null);
  protected readonly labels = signal<string[]>(this.data.labels ?? []);
  protected readonly parent = signal<TicketRef | null>(null);
  protected readonly parentKey = signal<string | null>(this.data.parentKey ?? null);
  protected readonly assignee = signal<UserRef | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly fieldErrors = signal<Record<string, string>>({});

  protected readonly assigneeSearch = this.people.picker(() => this.projectKey());
  protected readonly mentionSearch = this.people.mentionSearch(() => this.projectKey());
  protected readonly canSubmit = computed(
    () => !!this.projectKey() && !!this.title().trim() && !this.saving(),
  );
  protected readonly labelSuggestions = (prefix: string) =>
    this.hints.get(this.projectKey(), 'labels', prefix);
  protected readonly parentSearch = async (
    query: string,
  ): Promise<PickerOption<TicketRef | null>[]> => {
    if (!this.projectKey()) return [];
    const found = await firstValueFrom(this.api.find(this.projectKey(), query));
    const options: PickerOption<TicketRef | null>[] = found.map((t) => ({
      value: t,
      label: `${t.key} ${t.title}`,
    }));
    if (this.parentKey()) options.unshift({ value: null, label: 'No parent' });
    return options;
  };

  constructor() {
    void this.directory.load().then(() => {
      if (!this.projectKey() && this.projects().length) this.projectKey.set(this.projects()[0].key);
    });
    effect(() => {
      const key = this.projectKey();
      const wanted = this.data.assignee;
      if (!key || !wanted) return;
      untracked(() => {
        void this.people
          .search(key, wanted)
          .then((users) =>
            this.assignee.set(users.find((u) => u.id === wanted || u.email === wanted) ?? null),
          )
          .catch(() => undefined);
      });
    });
  }

  protected setProject(key: string): void {
    if (key === this.projectKey()) return;
    this.projectKey.set(key);
    this.parent.set(null);
    this.parentKey.set(null);
    this.assignee.set(null);
  }

  protected setParent(parent: TicketRef | null): void {
    this.parent.set(parent);
    this.parentKey.set(parent?.key ?? null);
  }

  protected setAssignee(user: UserRef | null): void {
    this.assignee.set(user);
  }

  protected toggleLabel(toggle: LabelToggle): void {
    this.labels.update((labels) =>
      toggle.add
        ? [...new Set([...labels, toggle.label])].sort()
        : labels.filter((l) => l !== toggle.label),
    );
  }

  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      void this.create(event.shiftKey);
    }
  }

  protected async create(open = false): Promise<void> {
    if (!this.canSubmit()) return;
    this.saving.set(true);
    this.error.set(null);
    this.fieldErrors.set({});
    const ticket: NewTicket = {
      title: this.title().trim(),
      type: this.type(),
      description: this.description().trim() || null,
      priority: this.priority(),
      severity: this.severity(),
      labels: this.labels(),
      parentKey: this.parentKey(),
      assignee: this.assignee()?.id ?? null,
      storyPoints: this.data.storyPoints ?? null,
      version: this.data.version ?? null,
      ...(this.data.status ? { status: this.data.status } : {}),
      ...(this.data.boardId ? { boardId: this.data.boardId } : {}),
    };
    try {
      const created = this.data.submit
        ? await this.data.submit(this.projectKey(), ticket)
        : await firstValueFrom(this.api.create(this.projectKey(), ticket, crypto.randomUUID()));
      this.events.emit({ kind: 'created', ticket: created });
      this.ref.close(created);
      if (open) this.peek.open(created.key);
      else if (!this.data.submit)
        this.toast.success(`${created.key} created`, {
          action: { label: 'Open', run: () => this.peek.open(created.key) },
        });
    } catch (error) {
      const apiError = toApiError(error);
      this.error.set(apiError.title);
      this.fieldErrors.set(
        Object.fromEntries(Object.entries(apiError.fieldErrors).map(([k, v]) => [k, v[0] ?? ''])),
      );
    } finally {
      this.saving.set(false);
    }
  }

  protected cancel(): void {
    this.ref.close(null);
  }
}
