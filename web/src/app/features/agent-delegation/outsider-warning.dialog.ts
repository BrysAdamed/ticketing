import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { ResolvedAgentPrompt } from '@core/agent/agent-delegation.client';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';

export interface OutsiderWarningDialogData {
  ticketKey: string;
  projectKey: string;
  content: NonNullable<ResolvedAgentPrompt['outsiderContent']>;
  /// Called synchronously from the button's click handler, so the launch keeps the user gesture.
  proceed: () => void;
}

/// Shown before a launch when the latest description or comment of a public project's ticket came
/// from a non-member (refinement §6 hardening, D-100): the agent reads that text over MCP.
@Component({
  selector: 'tk-outsider-warning-dialog',
  imports: [MatButtonModule, MatDialogModule, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-outsider-warning' },
  template: `
    <h2 mat-dialog-title>Check {{ data.ticketKey }} before the agent reads it</h2>
    <mat-dialog-content>
      <div class="tk-callout tk-callout-warning">
        <strong>{{ data.content.author?.displayName ?? 'Someone' }}</strong>
        wrote the latest {{ data.content.source === 'Comment' ? 'comment' : 'description' }}
        {{ data.content.at | relativeTime }} and isn't a member of {{ data.projectKey }}.
      </div>
      <p class="text">
        The agent reads the ticket over MCP, so text from outside the team can steer it. Read the
        ticket first, and review the prompt in Claude before you press Enter.
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" mat-dialog-close cdkFocusInitial>Cancel</button>
      <button
        mat-flat-button
        type="button"
        data-testid="agent-outsider-continue"
        (click)="proceed()"
      >
        Open anyway
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    :host {
      display: block;
      max-width: 480px;
    }
    .text {
      margin: 12px 0 0;
      color: var(--tk-text-muted);
    }
  `,
})
export class OutsiderWarningDialog {
  protected readonly data = inject<OutsiderWarningDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<OutsiderWarningDialog>);

  protected proceed(): void {
    this.ref.close();
    this.data.proceed();
  }
}
