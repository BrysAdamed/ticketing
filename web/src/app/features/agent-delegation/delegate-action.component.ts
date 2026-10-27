import { Clipboard } from '@angular/cdk/clipboard';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  untracked,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AgentDelegationClient, ResolvedAgentPrompt } from '@core/agent/agent-delegation.client';
import {
  CLAUDE_APP_LABELS,
  CLAUDE_PROMPT_LIMIT,
  ClaudeApp,
  claudeDeepLink,
  normalizePrompt,
} from '@core/agent/claude-deep-link';
import { ExternalUrlLauncher } from '@core/agent/launch-external-url';
import { toApiError } from '@core/api/api-error';
import { ToastService } from '@core/notify/toast.service';
import { ShortcutService } from '@core/shortcuts/shortcut.service';
import { TicketEvents } from '@core/tickets/ticket-events';
import { TicketHeaderHost, TicketMenuItem } from '@core/tickets/ticket-header-actions';
import { Ticket } from '@core/tickets/ticket.models';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AgentPreferences } from './agent-preferences';
import { DelegateActionStore } from './delegate-action.store';
import { DelegateHelpDialog, DelegateHelpDialogData } from './delegate-help.dialog';
import { availablePrompt, disabledReason } from './delegate-state';
import { LocalFolderDialog, LocalFolderDialogData } from './local-folder.dialog';
import { OutsiderWarningDialog, OutsiderWarningDialogData } from './outsider-warning.dialog';
import { PromptPreviewDialog, PromptPreviewDialogData } from './prompt-preview.dialog';

const MENU_OWNER = 'delegate';
const LAUNCH_TOAST_MS = 10_000;

/// Delegate to agent in the ticket header (refinement §1.8 and §6, ADR 0013, D-97, D-100): a split
/// button on the page, an icon button in the peek, two `…` menu items and `Shift+D`. A click opens
/// Claude through its deep link at once and records the delegation in parallel.
@Component({
  selector: 'tk-delegate-action',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatMenuModule,
    MatTooltip,
    RouterLink,
    IconComponent,
  ],
  providers: [DelegateActionStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './delegate-action.component.html',
  styleUrl: './delegate-action.component.scss',
})
export class DelegateActionComponent {
  private readonly store = inject(DelegateActionStore);
  private readonly host = inject(TicketHeaderHost);
  private readonly preferences = inject(AgentPreferences);
  private readonly client = inject(AgentDelegationClient);
  private readonly launcher = inject(ExternalUrlLauncher);
  private readonly dialog = inject(MatDialog);
  private readonly toast = inject(ToastService);
  private readonly clipboard = inject(Clipboard);
  private readonly events = inject(TicketEvents);

  readonly ticket = input.required<Ticket>();
  readonly presentation = input.required<'page' | 'peek'>();

  protected readonly apps: readonly ClaudeApp[] = ['ClaudeCode', 'ClaudeDesktop'];
  protected readonly appLabels = CLAUDE_APP_LABELS;
  protected readonly app = this.preferences.app;
  protected readonly state = this.store.state;
  protected readonly visible = computed(() => this.state().kind !== 'hidden');
  protected readonly ready = computed(() => this.state().kind === 'ready');
  protected readonly prompt = computed(() => availablePrompt(this.state()));
  protected readonly reason = computed(() => disabledReason(this.state()));
  protected readonly tooltip = computed(() => this.reason() ?? 'Delegate to agent  Shift D');
  protected readonly overLength = computed(() => {
    const state = this.state();
    return state.kind === 'tooLong' && state.length !== null
      ? `${state.length.toLocaleString('en-US')} / ${CLAUDE_PROMPT_LIMIT.toLocaleString('en-US')}`
      : null;
  });
  protected readonly folder = computed(() => this.preferences.folder(this.ticket().projectKey));
  protected readonly isOwner = computed(() => this.ticket().myRole === 'Owner');
  protected readonly settingsLink = computed(() => [
    '/projects',
    this.ticket().projectKey,
    'settings',
    'agent',
  ]);

  constructor() {
    effect(() => {
      const ticket = this.ticket();
      untracked(() => this.store.ticket.set(ticket));
    });

    effect(() => {
      const items: TicketMenuItem[] = this.visible()
        ? [
            {
              id: 'delegate',
              label: 'Delegate to agent',
              icon: 'tablerRobot',
              disabled: !this.ready(),
              run: () => this.delegate(),
            },
            {
              id: 'copy-agent-prompt',
              label: 'Copy agent prompt',
              icon: 'tablerCopy',
              disabled: !this.prompt(),
              run: () => this.copyPrompt(),
            },
          ]
        : [];
      untracked(() => this.host.setMenuItems(MENU_OWNER, items));
    });
    inject(DestroyRef).onDestroy(() => this.host.setMenuItems(MENU_OWNER, []));

    const shortcuts = inject(ShortcutService);
    effect((onCleanup) => {
      if (!this.visible() || !this.host.shortcutsActive()) return;
      const remove = untracked(() =>
        shortcuts.register({
          keys: 'shift+d',
          section: 'Ticket',
          description: 'Delegate to agent',
          handler: () => this.delegateFromShortcut(),
        }),
      );
      onCleanup(remove);
    });
  }

  /// Opens Claude for this ticket. Every step that may need the user (folder, outsider warning) runs
  /// its continuation from its own click, so the launch always happens inside a user gesture.
  protected delegate(): void {
    const state = this.state();
    if (state.kind !== 'ready') return;
    const ticket = this.ticket();
    const folder = this.preferences.folder(ticket.projectKey);
    if (folder) this.confirmOutsider(state.prompt, folder);
    else
      this.openFolderDialog(`Save and open ${this.appLabels[this.app()]}`, (saved) =>
        this.confirmOutsider(state.prompt, saved),
      );
  }

  protected copyPrompt(): void {
    const prompt = this.prompt();
    if (!prompt) return;
    if (!this.clipboard.copy(normalizePrompt(prompt.prompt))) {
      this.toast.error("Couldn't copy the prompt");
      return;
    }
    const repository = this.store.project()?.agent?.repositoryUrl;
    this.toast.success(
      repository
        ? `Prompt copied. Paste it into Claude Code in your clone of ${repository}`
        : 'Prompt copied. Paste it into Claude Code in your clone of the project',
    );
  }

  protected previewPrompt(): void {
    const prompt = this.prompt();
    if (!prompt) return;
    this.dialog.open<PromptPreviewDialog, PromptPreviewDialogData>(PromptPreviewDialog, {
      data: { prompt, copy: () => this.copyPrompt() },
      maxWidth: 'calc(100vw - 32px)',
    });
  }

  protected changeFolder(): void {
    this.openFolderDialog('Save', () => this.toast.success('Local folder saved'));
  }

  protected chooseApp(app: ClaudeApp): void {
    this.preferences.setApp(app);
  }

  protected openHelp(): void {
    this.dialog.open<DelegateHelpDialog, DelegateHelpDialogData>(DelegateHelpDialog, {
      data: {
        appLabel: this.appLabels[this.app()],
        folder: this.folder(),
        changeFolder: () => this.changeFolder(),
        copyPrompt: this.prompt() ? () => this.copyPrompt() : null,
      },
    });
  }

  private delegateFromShortcut(): void {
    if (this.ready()) this.delegate();
    else if (this.reason()) this.toast.show(this.reason()!);
  }

  private openFolderDialog(submitLabel: string, then: (folder: string) => void): void {
    const ticket = this.ticket();
    this.dialog.open<LocalFolderDialog, LocalFolderDialogData>(LocalFolderDialog, {
      data: {
        projectKey: ticket.projectKey,
        repositoryUrl: this.store.project()?.agent?.repositoryUrl ?? null,
        current: this.preferences.folder(ticket.projectKey),
        submitLabel,
        save: (folder) => {
          this.preferences.setFolder(ticket.projectKey, folder);
          then(folder);
        },
      },
    });
  }

  private confirmOutsider(prompt: ResolvedAgentPrompt, folder: string): void {
    const content = prompt.outsiderContent;
    if (!content) {
      this.launch(prompt, folder);
      return;
    }
    this.dialog.open<OutsiderWarningDialog, OutsiderWarningDialogData>(OutsiderWarningDialog, {
      data: {
        ticketKey: prompt.ticketKey,
        projectKey: this.ticket().projectKey,
        content,
        proceed: () => this.launch(prompt, folder),
      },
    });
  }

  /// Synchronous up to the navigation (D-97); the history record runs alongside and never delays it.
  private launch(prompt: ResolvedAgentPrompt, folder: string): void {
    const app = this.app();
    this.launcher.launch(claudeDeepLink(app, folder, prompt.prompt));
    this.toast.show(`Opening ${this.appLabels[app]}… Didn't open?`, {
      durationMs: LAUNCH_TOAST_MS,
      actions: [
        { label: 'Copy prompt', run: () => this.copyPrompt() },
        { label: 'Help', run: () => this.openHelp() },
      ],
    });
    void this.record(prompt, app);
  }

  private async record(launched: ResolvedAgentPrompt, app: ClaudeApp): Promise<void> {
    try {
      const ticket = await firstValueFrom(this.client.recordDelegation(launched, app));
      this.events.emit({ kind: 'updated', ticket });
      this.host.refresh();
    } catch (error) {
      this.toast.error(`The delegation wasn't recorded: ${toApiError(error).title}`);
    }
  }
}
