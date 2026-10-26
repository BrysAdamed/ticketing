import { Clipboard } from '@angular/cdk/clipboard';
import { DOCUMENT } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { PAT_SCOPE_LABELS } from '@shared/domain/enums';
import { AbsoluteTimePipe } from '@shared/pipes/relative-time.pipe';
import { IconComponent } from '@shared/ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentOption,
} from '@shared/ui/segmented/segmented-control.component';
import { CreatedToken } from './access-tokens.store';
import { claudeCodeCommand, mcpJson } from './token-snippets';

type CopyTarget = 'token' | 'snippet';
type SnippetKind = 'claude' | 'json';

/// Show-once dialog (layout-and-screens 3.10). The secret lives only in this dialog's data and is
/// gone once it closes; closing without copying asks once more.
@Component({
  selector: 'tk-token-created-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    IconComponent,
    SegmentedControlComponent,
    AbsoluteTimePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title class="title">
      <tk-icon name="tablerCircleCheck" [size]="20" class="ok" />
      Token created
    </h2>
    <mat-dialog-content class="content">
      <div class="tk-callout tk-callout-warning" role="note">
        <tk-icon name="tablerAlertTriangle" [size]="16" />
        <span>Copy this token now. You won't be able to see it again.</span>
      </div>

      <div class="meta tk-muted">
        <strong>{{ data.token.name }}</strong> · {{ scopeLabels[data.token.scope] }} · expires
        {{ data.token.expiresAt | absoluteTime }}
      </div>

      <div class="secret">
        <input
          class="mono"
          readonly
          aria-label="Access token"
          data-testid="token-secret"
          [value]="data.secret"
          (focus)="$any($event.target).select()"
        />
        <button
          mat-stroked-button
          type="button"
          data-testid="token-copy"
          (click)="copy('token', data.secret)"
        >
          <tk-icon [name]="copied() === 'token' ? 'tablerCheck' : 'tablerCopy'" [size]="14" />
          {{ copied() === 'token' ? 'Copied' : 'Copy' }}
        </button>
      </div>

      <section class="snippets" aria-label="Use with Claude Code">
        <div class="snippet-head">
          <span class="tk-field-label">Use with Claude Code</span>
          <tk-segmented
            ariaLabel="Snippet format"
            testId="token-snippet"
            [options]="snippetOptions"
            [value]="snippet()"
            (valueChange)="snippet.set($event)"
          />
        </div>
        <p class="tk-subtle hint">
          @if (snippet() === 'claude') {
            Run this in a terminal to register the MCP server for your user.
          } @else {
            Or save this as <code>.mcp.json</code> in a project. Keep it out of version control.
          }
        </p>
        <div class="code">
          <pre class="mono" data-testid="token-snippet-text">{{ snippetText() }}</pre>
          <button
            type="button"
            class="tk-icon-btn copy-snippet"
            [attr.aria-label]="copied() === 'snippet' ? 'Copied' : 'Copy snippet'"
            data-testid="token-snippet-copy"
            (click)="copy('snippet', snippetText())"
          >
            <tk-icon [name]="copied() === 'snippet' ? 'tablerCheck' : 'tablerCopy'" [size]="14" />
          </button>
        </div>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      @if (confirmingClose()) {
        <span class="confirm" role="alert">Close without copying? The token will be lost.</span>
        <button mat-button type="button" (click)="confirmingClose.set(false)">Keep open</button>
        <button
          mat-flat-button
          type="button"
          class="danger"
          data-testid="token-close-anyway"
          (click)="ref.close()"
        >
          Close
        </button>
      } @else {
        <button mat-flat-button type="button" data-testid="token-done" (click)="done()">
          Done
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .title {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ok {
      color: var(--tk-success);
    }
    .content {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .meta {
      font-size: var(--tk-text-sm);
    }
    .meta strong {
      color: var(--tk-text);
      font-weight: var(--tk-weight-medium);
    }
    .mono {
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
    }
    .secret {
      display: flex;
      gap: 8px;
    }
    .secret input {
      flex: 1;
      min-width: 0;
      height: 36px;
      padding: 0 10px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-subtle);
      color: var(--tk-text);
    }
    .secret input:focus {
      outline: none;
      border-color: var(--tk-accent);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
    }
    .secret button {
      height: 36px;
    }
    .snippet-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .hint {
      margin: 4px 0 6px;
      font-size: var(--tk-text-sm);
    }
    .code {
      position: relative;
    }
    pre {
      margin: 0;
      padding: 10px 40px 10px 12px;
      background: var(--tk-bg-subtle);
      border: 1px solid var(--tk-border);
      border-radius: var(--tk-radius-md);
      white-space: pre-wrap;
      word-break: break-all;
      max-height: 200px;
      overflow: auto;
    }
    .copy-snippet {
      position: absolute;
      top: 6px;
      right: 6px;
    }
    .confirm {
      margin-right: auto;
      color: var(--tk-danger-fg);
      font-size: var(--tk-text-sm);
    }
    .danger {
      --mat-button-filled-container-color: var(--tk-danger);
      --mat-button-filled-label-text-color: var(--tk-text-on-solid);
    }
  `,
})
export class TokenCreatedDialog {
  protected readonly data = inject<CreatedToken>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<TokenCreatedDialog>>(MatDialogRef);
  private readonly clipboard = inject(Clipboard);
  private readonly origin = inject(DOCUMENT).location.origin;

  protected readonly scopeLabels = PAT_SCOPE_LABELS;
  protected readonly snippetOptions: SegmentOption<SnippetKind>[] = [
    { value: 'claude', label: 'Command' },
    { value: 'json', label: '.mcp.json' },
  ];
  protected readonly snippet = signal<SnippetKind>('claude');
  protected readonly copied = signal<CopyTarget | null>(null);
  protected readonly confirmingClose = signal(false);
  private everCopied = false;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    const sub = this.ref.keydownEvents().subscribe((event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        this.done();
      }
    });
    inject(DestroyRef).onDestroy(() => {
      sub.unsubscribe();
      clearTimeout(this.resetTimer);
    });
  }

  protected snippetText(): string {
    return this.snippet() === 'claude'
      ? claudeCodeCommand(this.origin, this.data.secret)
      : mcpJson(this.origin, this.data.secret);
  }

  protected copy(target: CopyTarget, text: string): void {
    if (!this.clipboard.copy(text)) return;
    this.everCopied = true;
    this.confirmingClose.set(false);
    this.copied.set(target);
    clearTimeout(this.resetTimer);
    this.resetTimer = setTimeout(() => this.copied.set(null), 2000);
  }

  protected done(): void {
    if (this.everCopied || this.confirmingClose()) {
      this.ref.close();
      return;
    }
    this.confirmingClose.set(true);
  }
}
