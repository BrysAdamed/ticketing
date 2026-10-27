import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { ResolvedAgentPrompt } from '@core/agent/agent-delegation.client';
import { CLAUDE_PROMPT_LIMIT, normalizePrompt } from '@core/agent/claude-deep-link';
import { TICKET_TYPE_LABELS } from '@shared/domain/enums';
import { IconComponent } from '@shared/ui/icon/icon.component';

export interface PromptPreviewDialogData {
  prompt: ResolvedAgentPrompt;
  copy: () => void;
}

/// Read-only view of the prompt Delegate would open Claude with, its template and its length.
@Component({
  selector: 'tk-prompt-preview-dialog',
  imports: [MatButtonModule, MatDialogModule, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-prompt-preview' },
  template: `
    <h2 mat-dialog-title>Agent prompt for {{ data.prompt.ticketKey }}</h2>
    <mat-dialog-content>
      <div class="meta">
        <span
          >{{ typeLabels[data.prompt.ticketType] }} prompt ·
          {{ data.prompt.template.source === 'Custom' ? 'custom' : 'default' }} v{{
            data.prompt.template.version
          }}</span
        >
        <span>Guardrails v{{ data.prompt.guardrailsVersion }}</span>
        <span class="tnum" [class.over]="length > limit" data-testid="agent-prompt-length"
          >{{ length.toLocaleString('en-US') }} /
          {{ limit.toLocaleString('en-US') }} characters</span
        >
      </div>
      <pre class="prompt" data-testid="agent-prompt-text">{{ text }}</pre>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close>Close</button>
      <button
        mat-stroked-button
        type="button"
        data-testid="agent-prompt-copy"
        (click)="data.copy()"
      >
        <tk-icon name="tablerCopy" [size]="14" />Copy prompt
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      width: 680px;
      max-width: 100%;
    }
    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 4px 16px;
      margin-bottom: 10px;
      color: var(--tk-text-muted);
      font-size: var(--tk-text-sm);
    }
    .over {
      color: var(--tk-danger-fg);
    }
    .prompt {
      margin: 0;
      max-height: 55vh;
      overflow: auto;
      padding: 10px 12px;
      border: 1px solid var(--tk-border-subtle);
      border-radius: var(--tk-radius-md);
      background: var(--tk-bg-subtle);
      color: var(--tk-text);
      font-family: var(--tk-font-mono);
      font-size: var(--tk-text-sm);
      line-height: 1.5;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    tk-icon {
      margin-right: 6px;
    }
  `,
})
export class PromptPreviewDialog {
  protected readonly data = inject<PromptPreviewDialogData>(MAT_DIALOG_DATA);
  protected readonly typeLabels = TICKET_TYPE_LABELS;
  protected readonly limit = CLAUDE_PROMPT_LIMIT;
  protected readonly text = normalizePrompt(this.data.prompt.prompt);
  protected readonly length = this.text.length;
}
