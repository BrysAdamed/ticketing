import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { OUTSIDER_CONTENT_LABELS, ResolvedAgentPrompt } from '@core/agent/agent-delegation.client';
import { RelativeTimePipe } from '@shared/pipes/relative-time.pipe';

export interface OutsiderWarningDialogData {
  ticketKey: string;
  content: NonNullable<ResolvedAgentPrompt['outsiderContent']>;
  /// Called synchronously from the button's click handler, so the launch keeps the user gesture.
  proceed: () => void;
}

/// Shown before a launch when text the agent reads over MCP (the ticket, its related tickets and
/// test cases) came from outside the team (refinement §6 hardening, D-100, D-104, D-106).
@Component({
  selector: 'tk-outsider-warning-dialog',
  imports: [MatButtonModule, MatDialogModule, RelativeTimePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'agent-outsider-warning' },
  template: `
    <h2 mat-dialog-title>Check {{ data.ticketKey }} before the agent reads it</h2>
    <mat-dialog-content>
      <div class="tk-callout tk-callout-warning">
        <span>
          <strong>{{ data.content.author?.displayName ?? 'Someone' }}</strong>
          {{ action }}
          @if (data.content.itemKey; as itemKey) {
            <strong data-testid="agent-outsider-item">{{ itemKey }}</strong>
          }
          {{ data.content.at | relativeTime }} and isn't an Owner or Member of
          {{ data.content.projectKey }}.
        </span>
      </div>
      <p class="text">
        The agent reads the ticket and its related tickets and test cases over MCP, so text from
        outside the team can steer it. Read them first, and review the prompt in Claude before you
        press Enter.
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
  protected readonly action = OUTSIDER_CONTENT_LABELS[this.data.content.source];
  private readonly ref = inject(MatDialogRef<OutsiderWarningDialog>);

  protected proceed(): void {
    this.ref.close();
    this.data.proceed();
  }
}
