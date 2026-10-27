import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface DelegateHelpDialogData {
  appLabel: string;
  folder: string | null;
  changeFolder: () => void;
  copyPrompt: (() => void) | null;
}

/// "Didn't open?": the page cannot tell whether Claude started (ADR 0013), so it explains the
/// usual causes in the order they happen.
@Component({
  selector: 'tk-delegate-help-dialog',
  imports: [MatButtonModule, MatDialogModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-help' },
  template: `
    <h2 mat-dialog-title>{{ data.appLabel }} didn't open?</h2>
    <mat-dialog-content>
      <ol class="steps">
        <li>
          <strong>Your browser asks first.</strong> Choose <em>Open {{ data.appLabel }}</em> in its
          dialog. Tick <em>Always allow</em> to skip the question next time.
        </li>
        <li>
          <strong>Install Claude Code and register its links.</strong> Install it as the
          <a href="https://code.claude.com/docs" target="_blank" rel="noopener">Claude Code docs</a>
          describe, run <code>claude</code> in a terminal and send one prompt: that registers the
          <code>claude-cli://</code>
          <a href="https://code.claude.com/docs/en/deep-links" target="_blank" rel="noopener"
            >links</a
          >
          this button uses. Claude Desktop registers its own links when installed.
        </li>
        <li>
          <strong>The folder must exist.</strong> A terminal that says "Could not access starting
          directory" means the saved path is wrong.
          @if (data.folder; as folder) {
            It is <code>{{ folder }}</code> now.
          }
          <button
            mat-button
            type="button"
            data-testid="agent-help-change-folder"
            (click)="changeFolder()"
          >
            Change local folder
          </button>
        </li>
        <li>
          <strong>Your organisation may have turned Claude's links off.</strong> Copy the prompt,
          run <code>claude</code> in your clone and paste it.
        </li>
      </ol>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Close</button>
      @if (data.copyPrompt; as copy) {
        <button mat-stroked-button type="button" data-testid="agent-help-copy" (click)="copy()">
          Copy prompt
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      max-width: 560px;
    }
    .steps {
      margin: 0;
      padding-left: 20px;
      display: flex;
      flex-direction: column;
      gap: 10px;
      color: var(--tk-text-muted);
    }
    strong {
      color: var(--tk-text);
    }
    code {
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
    }
  `,
})
export class DelegateHelpDialog {
  protected readonly data = inject<DelegateHelpDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<DelegateHelpDialog>);

  protected changeFolder(): void {
    this.ref.close();
    this.data.changeFolder();
  }
}
