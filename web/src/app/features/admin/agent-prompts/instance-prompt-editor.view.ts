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
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RouterLink } from '@angular/router';
import { AgentPromptEditorStore } from '@core/agent/agent-prompt-editor.store';
import {
  AGENT_PROMPT_CHANGE_NOTE_MAX,
  AgentPromptVersion,
  InstanceAgentPrompt,
} from '@core/agent/agent-prompt.models';
import { promptSlotFromSlug, promptSlotLabel } from '@core/agent/prompt-slugs';
import { LeaveGuarded } from '@core/layout/unsaved-changes.guard';
import { ConfirmService } from '@core/notify/confirm.service';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { LengthMeterComponent } from '@shared/agent-prompts/length-meter.component';
import { PromptDiffComponent } from '@shared/agent-prompts/prompt-diff.component';
import { PromptHistoryComponent } from '@shared/agent-prompts/prompt-history.component';
import { PromptPreviewComponent } from '@shared/agent-prompts/prompt-preview.component';
import { TemplateEditorComponent } from '@shared/agent-prompts/template-editor.component';
import { AbsoluteTimePipe, RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { BadgeComponent } from '@shared/ui/domain/badge.component';
import { TypeIconComponent } from '@shared/ui/domain/type-icon.component';
import { UserDisplayComponent } from '@shared/ui/domain/user-display.component';
import { EmptyStateComponent } from '@shared/ui/empty-state/empty-state.component';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { KbdComponent } from '@shared/ui/kbd/kbd.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { SkeletonRowsComponent } from '@shared/ui/skeleton/skeleton-rows.component';
import { PromptOverridesDialog, PromptOverridesDialogData } from './prompt-overrides.dialog';

type Panel = 'preview' | 'compare' | 'history';

/// The version opened from the history: shown as text, or as a diff against the current version.
interface OpenedVersion {
  version: AgentPromptVersion;
  diff: boolean;
}

const PANEL_OPTIONS: readonly SegmentOption<Panel>[] = [
  { value: 'preview', label: 'Preview' },
  { value: 'compare', label: 'Compare with built-in' },
  { value: 'history', label: 'History' },
];

/// Admin → Agent prompts → one instance slot (`agent-prompts/:slot`): a ticket type's default or the
/// guardrails, with a live preview, compare with the shipped built-in, Reset to built-in, the
/// "newer built-in available" banner with Adopt, the projects overriding a type, and history.
@Component({
  selector: 'tk-instance-prompt-editor-view',
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
  templateUrl: './instance-prompt-editor.view.html',
  styleUrls: [
    '../../../shared/agent-prompts/prompt-editor-page.scss',
    './instance-prompt-editor.view.scss',
  ],
  host: {
    'data-testid': 'view-admin.agent-prompt',
    '(window:beforeunload)': 'onBeforeUnload($event)',
  },
})
export class InstancePromptEditorView implements LeaveGuarded {
  protected readonly store = inject(AgentPromptEditorStore);
  private readonly confirm = inject(ConfirmService);
  private readonly toast = inject(ToastService);
  private readonly dialog = inject(MatDialog);
  protected readonly shortcuts = inject(ShortcutService);

  readonly slot = input.required<string>();

  protected readonly panelOptions = PANEL_OPTIONS;
  protected readonly changeNoteMax = AGENT_PROMPT_CHANGE_NOTE_MAX;
  protected readonly panel = signal<Panel>('preview');
  protected readonly opened = signal<OpenedVersion | null>(null);

  protected readonly target = computed(() => promptSlotFromSlug(this.slot()));
  protected readonly isGuardrails = computed(() => this.target() === 'Guardrails');
  protected readonly type = computed(() => {
    const target = this.target();
    return target && target !== 'Guardrails' ? target : null;
  });
  protected readonly label = computed(() => {
    const target = this.target();
    return target ? promptSlotLabel(target) : '';
  });
  protected readonly title = computed(() =>
    this.isGuardrails() ? 'Guardrails' : `${this.label()} default prompt`,
  );
  protected readonly document = this.store.document;
  protected readonly prompt = computed(
    () => (this.document()?.raw as InstanceAgentPrompt | undefined) ?? null,
  );
  protected readonly chip = computed(() => {
    const prompt = this.prompt();
    if (!prompt) return '';
    return `v${prompt.version} · ${prompt.followsBuiltIn ? `Built-in ${prompt.builtInVersion}` : 'Edited'}`;
  });
  protected readonly savedText = computed(() => this.document()?.body ?? '');
  /// For the guardrails, the preview's greyed part is the sample type prompt before them; with no
  /// guardrails at all, everything is that sample.
  protected readonly splitAt = computed(() => {
    const preview = this.store.preview();
    if (!preview?.prompt) return null;
    return preview.guardrailsStart ?? (this.isGuardrails() ? preview.prompt.length : null);
  });

  constructor() {
    effect(() => {
      const target = this.target();
      if (!target) return;
      untracked(() => {
        this.panel.set('preview');
        this.opened.set(null);
        this.store.setEditable(true);
        void this.store.open({ kind: 'instance' }, target);
      });
    });
    this.shortcuts.registerScoped([
      {
        keys: 'mod+s',
        description: 'Save the prompt',
        section: 'Agent prompt',
        allowInInputs: true,
        handler: () => void this.store.save(),
      },
    ]);
  }

  async confirmLeave(): Promise<boolean> {
    if (!this.store.dirty()) return true;
    return this.confirm.confirm({
      title: 'Discard your changes?',
      message: `Your changes to the ${this.title().toLowerCase()} are not saved.`,
      confirmLabel: 'Discard',
      danger: true,
    });
  }

  protected onBeforeUnload(event: BeforeUnloadEvent): void {
    if (this.store.dirty()) event.preventDefault();
  }

  protected async resetToBuiltIn(adopt: boolean): Promise<void> {
    const prompt = this.prompt();
    if (!prompt) return;
    const confirmed = await this.confirm.confirm({
      title: adopt
        ? `Adopt built-in ${prompt.latestBuiltInVersion}?`
        : `Reset the ${this.title().toLowerCase()} to the built-in?`,
      message:
        'The shipped text becomes a new version and later built-ins are adopted automatically. ' +
        (this.store.dirty()
          ? 'Your unsaved changes are discarded; the current text stays in the history.'
          : 'The current text stays in the history.'),
      confirmLabel: adopt ? 'Adopt' : 'Reset to built-in',
    });
    if (confirmed) await this.store.reset();
  }

  protected openOverrides(): void {
    const target = this.target();
    if (!target) return;
    this.dialog.open<PromptOverridesDialog, PromptOverridesDialogData>(PromptOverridesDialog, {
      width: '640px',
      data: { slot: target },
    });
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
}
