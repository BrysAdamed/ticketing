import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AgentPromptEditorStore } from '@core/agent/agent-prompt-editor.store';
import {
  AGENT_PROMPT_CHANGE_NOTE_MAX,
  AgentPromptMode,
  AgentPromptVersion,
} from '@core/agent/agent-prompt.models';
import { LeaveGuarded } from '@core/layout/unsaved-changes.guard';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ProjectContext } from '@core/projects/project-context';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { TicketsApi } from '@core/tickets/tickets.api';
import { LengthMeterComponent } from '@shared/agent-prompts/length-meter.component';
import { PromptDiffComponent } from '@shared/agent-prompts/prompt-diff.component';
import { PromptHistoryComponent } from '@shared/agent-prompts/prompt-history.component';
import { PromptPreviewComponent } from '@shared/agent-prompts/prompt-preview.component';
import { TemplateEditorComponent } from '@shared/agent-prompts/template-editor.component';
import { TICKET_TYPE_LABELS } from '@shared/domain/enums';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import { SearchPickerDirective } from '@shared/ui/search-picker/search-picker.directive';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { promptTypeFromSlug } from './prompt-slugs';

type Panel = 'preview' | 'compare' | 'history';

/// The version opened from the history: shown as text, or as a diff against the current version.
interface OpenedVersion {
  version: AgentPromptVersion;
  diff: boolean;
}

const MODE_OPTIONS: readonly SegmentOption<AgentPromptMode>[] = [
  { value: 'Inherit', label: 'Use default' },
  { value: 'Custom', label: 'Custom' },
  { value: 'Off', label: 'Off' },
];

const PANEL_OPTIONS: readonly SegmentOption<Panel>[] = [
  { value: 'preview', label: 'Preview' },
  { value: 'compare', label: 'Compare with default' },
  { value: 'history', label: 'History' },
];

const SAMPLE_TICKET = '';

/// Project settings → Agent → one ticket type's prompt (`settings/agent/:ticketType`): mode, the
/// template editor with a live server preview, compare with the default, reset, history and restore.
@Component({
  selector: 'tk-agent-prompt-editor-view',
  imports: [
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    TemplateEditorComponent,
    PromptPreviewComponent,
    PromptDiffComponent,
    PromptHistoryComponent,
    LengthMeterComponent,
    SegmentedControlComponent,
    SearchPickerDirective,
    BadgeComponent,
    TypeIconComponent,
    UserDisplayComponent,
    EmptyStateComponent,
    IconComponent,
    KbdComponent,
    SkeletonRowsComponent,
    RelativeTimePipe,
    AbsoluteTimePipe,
  ],
  providers: [AgentPromptEditorStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './agent-prompt-editor.view.html',
  styleUrl: './agent-prompt-editor.view.scss',
  host: {
    'data-testid': 'view-project.settings.agent-prompt',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class AgentPromptEditorView implements LeaveGuarded {
  protected readonly store = inject(AgentPromptEditorStore);
  protected readonly context = inject(ProjectContext);
  private readonly tickets = inject(TicketsApi);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  protected readonly shortcuts = inject(ShortcutService);

  readonly projectKey = input.required<string>();
  readonly ticketType = input.required<string>();

  protected readonly modeOptions = MODE_OPTIONS;
  protected readonly panelOptions = PANEL_OPTIONS;
  protected readonly changeNoteMax = AGENT_PROMPT_CHANGE_NOTE_MAX;
  protected readonly panel = signal<Panel>('preview');
  protected readonly opened = signal<OpenedVersion | null>(null);

  protected readonly type = computed(() => promptTypeFromSlug(this.ticketType()));
  protected readonly typeLabel = computed(() => {
    const type = this.type();
    return type ? TICKET_TYPE_LABELS[type] : '';
  });
  protected readonly editable = computed(
    () => this.context.isOwner() && !this.context.isArchived(),
  );
  protected readonly document = this.store.document;
  protected readonly chip = computed(() => {
    const document = this.document();
    if (!document) return '';
    if (document.mode === 'Off') return 'Off';
    return document.mode === 'Custom' ? `Custom v${document.version}` : document.reference.label;
  });
  /// What the type would send now: the draft for Custom, the default for Use default, nothing for Off.
  protected readonly currentText = computed(() => {
    const document = this.document();
    if (!document) return '';
    const mode = this.store.mode();
    return mode === 'Custom'
      ? this.store.body()
      : mode === 'Inherit'
        ? document.reference.body
        : '';
  });
  protected readonly savedText = computed(() => this.document()?.effectiveBody ?? '');
  protected readonly showDefaultChanged = computed(() => {
    const document = this.document();
    return !!document && document.mode === 'Custom' && document.referenceChanged;
  });
  protected readonly sampleLabel = computed(() => this.store.previewTicketKey() || 'Sample ticket');

  protected readonly findSample = async (query: string): Promise<PickerOption<string>[]> => {
    const type = this.type();
    const found = type
      ? await firstValueFrom(this.tickets.find(this.context.projectKey(), query, [type]))
      : [];
    return [
      { value: SAMPLE_TICKET, label: 'Sample ticket', icon: { kind: 'icon', name: 'tablerFlask' } },
      ...found.map((t) => ({
        value: t.key,
        label: `${t.key} ${t.title}`,
        icon: { kind: 'type' as const, type: t.type },
      })),
    ];
  };

  constructor() {
    effect(() => {
      const type = this.type();
      const projectKey = this.projectKey().toUpperCase();
      if (!type) return;
      untracked(() => {
        this.panel.set('preview');
        this.opened.set(null);
        void this.store.open({ kind: 'project', projectKey }, type, () =>
          this.latestTicketOf(projectKey),
        );
      });
    });
    effect(() => this.store.setEditable(this.editable()));
    this.shortcuts.registerScoped([
      {
        keys: 'mod+s',
        description: 'Save the prompt',
        section: 'Agent prompt',
        allowInInputs: true,
        handler: () => void this.save(),
      },
    ]);
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.store.dirty()) return true;
    return this.confirm.confirm({
      title: 'Discard your changes?',
      message: `Your changes to the ${this.typeLabel()} prompt are not saved.`,
      confirmLabel: 'Discard',
      danger: true,
    });
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }

  protected async save(): Promise<void> {
    await this.store.save();
  }

  protected async reset(): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Use the default ${this.typeLabel()} prompt?`,
      message:
        'The type goes back to the default prompt as a new version. The custom text stays in the history.',
      confirmLabel: 'Use default',
    });
    if (confirmed) await this.store.reset();
  }

  protected async openVersion(number: number, diff: boolean): Promise<void> {
    try {
      this.opened.set({ version: await this.store.version(number), diff });
    } catch (error) {
      this.toast.error(error);
    }
  }

  protected async restore(number: number): Promise<void> {
    const confirmed = await this.confirm.confirm({
      title: `Restore version ${number}?`,
      message: this.store.dirty()
        ? 'It becomes the newest version. Your unsaved changes are discarded.'
        : 'It becomes the newest version; nothing in the history is lost.',
      confirmLabel: 'Restore',
    });
    if (!confirmed) return;
    if (await this.store.restore(number)) this.opened.set(null);
  }

  protected showPanel(panel: Panel): void {
    this.panel.set(panel);
    this.opened.set(null);
    if (panel === 'history' && !this.store.versions()) void this.store.loadVersions();
  }

  protected closeVersion(): void {
    this.opened.set(null);
  }

  protected pickSample(key: string): void {
    this.store.setPreviewTicket(key || null);
  }

  private async latestTicketOf(projectKey: string): Promise<string | null> {
    const type = this.type();
    if (!type) return null;
    const found = await firstValueFrom(this.tickets.find(projectKey, '', [type]));
    return found[0]?.key ?? null;
  }
}
