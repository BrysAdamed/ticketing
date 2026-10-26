import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /// When set, the confirm button stays disabled until the user types this exact text
  /// (used for deleting projects, users and tokens).
  requireText?: string;
}

@Component({
  selector: 'tk-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h2 mat-dialog-title>{{ options.title }}</h2>
    <mat-dialog-content>
      @if (options.message) {
        <p class="message">{{ options.message }}</p>
      }
      @if (options.requireText; as text) {
        <label class="tk-field-label" for="confirm-text">
          Type <strong>{{ text }}</strong> to confirm
        </label>
        <input
          id="confirm-text"
          class="input"
          autocomplete="off"
          data-testid="confirm-text"
          (input)="typed.set($any($event.target).value)"
          (keydown.enter)="canConfirm() && ref.close(true)"
        />
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" data-testid="confirm-cancel" (click)="ref.close(false)">
        {{ options.cancelLabel ?? 'Cancel' }}
      </button>
      <button
        mat-flat-button
        type="button"
        data-testid="confirm-ok"
        [class.danger]="options.danger"
        [disabled]="!canConfirm()"
        (click)="ref.close(true)"
      >
        {{ options.confirmLabel ?? 'Confirm' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .message {
      margin: 0 0 12px;
      color: var(--tk-text-muted);
    }
    .input {
      width: 100%;
      height: 32px;
      padding: 0 10px;
      border: 1px solid var(--tk-border-input);
      border-radius: var(--tk-radius-md);
      background: var(--tk-surface);
      color: var(--tk-text);
      font: inherit;
    }
    .input:focus {
      outline: none;
      border-color: var(--tk-accent);
      box-shadow: 0 0 0 3px var(--tk-accent-subtle);
    }
    .danger:not([disabled]) {
      --mat-button-filled-container-color: var(--tk-danger);
      --mat-button-filled-label-text-color: var(--tk-text-on-solid);
    }
  `,
})
export class ConfirmDialog {
  protected readonly options = inject<ConfirmOptions>(MAT_DIALOG_DATA);
  protected readonly ref = inject<MatDialogRef<ConfirmDialog, boolean>>(MatDialogRef);
  protected readonly typed = signal('');
  protected readonly canConfirm = computed(
    () => !this.options.requireText || this.typed() === this.options.requireText,
  );
}
