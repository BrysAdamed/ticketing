import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT, NgTemplateOutlet } from '@angular/common';
import {
  afterNextRender,
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  ElementRef,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import { AccessTokensStore, CreatedToken } from './access-tokens.store';
import {
  CONNECTION_POLL_MS,
  connectAgentState,
  GuideStepState,
  suggestTokenName,
  TOKEN_PLACEHOLDER,
} from './connect-agent.logic';
import { CreateTokenDialog, CreateTokenDialogData } from './create-token.dialog';
import { claudeCodeCommand } from './token-snippets';

/// The Connect an AI agent guide (spec 14.8, D-141): create a token, copy the `claude mcp add`
/// command, and a connection check that polls the token list until the token has been used. The
/// secret of a token created here lives only in this component, like the show-once dialog.
@Component({
  selector: 'tk-connect-agent-guide',
  imports: [NgTemplateOutlet, MatButtonModule, IconComponent, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(window:focus)': 'onWindowFocus()' },
  template: `
    <section class="guide" aria-labelledby="connect-agent-title" data-testid="connect-agent-guide">
      <div class="head">
        <tk-icon name="tablerPlug" [size]="16" class="head-icon" />
        <h2 id="connect-agent-title" tabindex="-1" #title>Connect an AI agent</h2>
        <span class="tk-muted sub">Use Ticketing from Claude Code over MCP.</span>
        <button
          type="button"
          class="tk-icon-btn end"
          aria-label="Close guide"
          data-testid="connect-agent-close"
          (click)="closed.emit()"
        >
          <tk-icon name="tablerX" [size]="16" />
        </button>
      </div>

      <ol class="steps">
        <li class="step" [attr.data-state]="state().step1" data-testid="connect-agent-step-token">
          <ng-container
            *ngTemplateOutlet="marker; context: { $implicit: state().step1, n: 1 }"
          ></ng-container>
          <div class="body">
            <h3>Create a token</h3>
            @if (created(); as token) {
              <p class="tk-muted">
                <strong>{{ token.token.name }}</strong> is ready. It acts as you, with your
                permissions.
              </p>
            } @else if (state().target; as token) {
              <p class="tk-muted">
                You have an active token, <strong>{{ token.name }}</strong
                >. Use it, or create one for this agent.
              </p>
              <button
                mat-stroked-button
                type="button"
                data-testid="connect-agent-create"
                [disabled]="store.atLimit()"
                (click)="createToken()"
              >
                <tk-icon name="tablerPlus" [size]="14" />
                Create a new token
              </button>
            } @else {
              <p class="tk-muted">
                A personal access token lets the agent act as you. It always expires and can be
                revoked here at any time.
              </p>
              <button
                mat-flat-button
                type="button"
                data-testid="connect-agent-create"
                [disabled]="store.atLimit()"
                (click)="createToken()"
              >
                <tk-icon name="tablerPlus" [size]="14" />
                Create a token
              </button>
            }
          </div>
        </li>

        <li class="step" [attr.data-state]="state().step2" data-testid="connect-agent-step-command">
          <ng-container
            *ngTemplateOutlet="marker; context: { $implicit: state().step2, n: 2 }"
          ></ng-container>
          <div class="body">
            <h3>Copy the command</h3>
            @if (state().step1 === 'done') {
              <p class="tk-muted">
                Run it in a terminal to register the Ticketing MCP server for your user.
                @if (created()) {
                  Copy it now: the token is not shown again once you leave this page.
                } @else {
                  Replace <code>{{ placeholder }}</code> with your token.
                }
              </p>
              <div class="code">
                <pre class="mono" data-testid="connect-agent-command">{{ command() }}</pre>
                <button
                  type="button"
                  class="tk-icon-btn copy"
                  [attr.aria-label]="copiedNow() ? 'Copied' : 'Copy command'"
                  data-testid="connect-agent-copy"
                  (click)="copy()"
                >
                  <tk-icon [name]="copiedNow() ? 'tablerCheck' : 'tablerCopy'" [size]="14" />
                </button>
              </div>
            } @else {
              <p class="tk-subtle">
                The <code>claude mcp add</code> command, with your token in it.
              </p>
            }
          </div>
        </li>

        <li class="step" [attr.data-state]="state().step3" data-testid="connect-agent-step-check">
          <ng-container
            *ngTemplateOutlet="marker; context: { $implicit: state().step3, n: 3 }"
          ></ng-container>
          <div class="body">
            <h3>Check the connection</h3>
            <div
              role="status"
              data-testid="connect-agent-status"
              [attr.data-connected]="state().connected"
            >
              @if (state().connected) {
                <p class="ok">
                  <tk-icon name="tablerCircleCheck" [size]="16" />
                  <span
                    >Connected. <strong>{{ state().target?.name }}</strong> was used
                    {{ state().target?.lastUsedAt | relativeTime }}.</span
                  >
                </p>
              } @else if (state().step1 === 'done') {
                <p class="tk-muted waiting">
                  <span class="pulse" aria-hidden="true"></span>
                  <span
                    >Waiting for the first call. Start Claude Code and ask it to call
                    <code>whoami</code>.</span
                  >
                </p>
              } @else {
                <p class="tk-subtle">Turns green once the agent has used the token.</p>
              }
            </div>
          </div>
        </li>
      </ol>
    </section>

    <ng-template #marker let-step let-n="n">
      <span class="marker" aria-hidden="true">
        @if (step === 'done') {
          <tk-icon name="tablerCheck" [size]="14" />
        } @else {
          {{ n }}
        }
      </span>
      <span class="tk-sr-only">{{ stepLabel(step) }}</span>
    </ng-template>
  `,
  styleUrl: './connect-agent-guide.component.scss',
})
export class ConnectAgentGuideComponent {
  protected readonly store = inject(AccessTokensStore);
  private readonly dialog = inject(MatDialog);
  private readonly clipboard = inject(Clipboard);
  private readonly document = inject(DOCUMENT);
  private readonly title = viewChild.required<ElementRef<HTMLElement>>('title');

  readonly closed = output<void>();

  protected readonly placeholder = TOKEN_PLACEHOLDER;
  protected readonly created = signal<CreatedToken | null>(null);
  private readonly copied = signal(false);
  protected readonly copiedNow = signal(false);
  protected readonly state = computed(() =>
    connectAgentState(this.store.tokens(), this.created()?.token.id ?? null, this.copied()),
  );
  protected readonly command = computed(() =>
    claudeCodeCommand(this.document.location.origin, this.created()?.secret ?? TOKEN_PLACEHOLDER),
  );
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    afterNextRender(() => {
      const title = this.title().nativeElement;
      title.scrollIntoView({ block: 'nearest' });
      title.focus({ preventScroll: true });
    });

    effect((onCleanup) => {
      if (!this.state().polling) return;
      const timer = setInterval(() => this.poll(), CONNECTION_POLL_MS);
      onCleanup(() => clearInterval(timer));
    });

    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this.resetTimer);
      this.created.set(null);
    });
  }

  protected stepLabel(step: GuideStepState): string {
    return step === 'done' ? 'Done' : step === 'current' ? 'Current step' : 'Not started';
  }

  protected async createToken(): Promise<void> {
    await firstValueFrom(
      this.dialog
        .open<CreateTokenDialog, CreateTokenDialogData, CreatedToken>(CreateTokenDialog, {
          width: '480px',
          data: {
            create: async (request) => {
              const created = await this.store.create(request);
              this.copied.set(false);
              this.created.set(created);
              return created;
            },
            name: suggestTokenName(this.store.tokens()),
          },
        })
        .afterClosed(),
    );
  }

  protected copy(): void {
    if (!this.clipboard.copy(this.command())) return;
    this.copied.set(true);
    this.copiedNow.set(true);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.copiedNow.set(false), 2000);
  }

  protected onWindowFocus(): void {
    if (this.state().polling) void this.store.refresh();
  }

  private poll(): void {
    if (this.document.visibilityState === 'hidden') return;
    void this.store.refresh();
  }
}
