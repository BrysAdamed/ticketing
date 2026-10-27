import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MAT_SNACK_BAR_DATA, MatSnackBarRef } from '@angular/material/snack-bar';
import { IconComponent } from '@shared/ui/icon/icon.component';

export type ToastIntent = 'info' | 'success' | 'warning' | 'danger';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastData {
  message: string;
  intent: ToastIntent;
  actions: readonly ToastAction[];
}

const ICONS: Record<ToastIntent, string> = {
  info: 'tablerInfoCircle',
  success: 'tablerCircleCheck',
  warning: 'tablerAlertTriangle',
  danger: 'tablerAlertCircle',
};

@Component({
  selector: 'tk-toast',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[attr.data-intent]': 'data.intent', 'data-testid': 'toast' },
  template: `
    <tk-icon class="icon" [name]="icon" [size]="16" />
    <span class="message">{{ data.message }}</span>
    @for (action of data.actions; track action.label) {
      <button type="button" class="action" (click)="run(action.run)">{{ action.label }}</button>
    }
    <button
      type="button"
      class="tk-icon-btn tk-icon-btn-sm"
      aria-label="Dismiss"
      (click)="ref.dismiss()"
    >
      <tk-icon name="tablerX" [size]="14" />
    </button>
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 24px;
      max-width: 420px;
      color: var(--tk-text);
    }
    .icon {
      color: var(--tk-info);
    }
    :host([data-intent='success']) .icon {
      color: var(--tk-success);
    }
    :host([data-intent='warning']) .icon {
      color: var(--tk-warning);
    }
    :host([data-intent='danger']) .icon {
      color: var(--tk-danger);
    }
    .message {
      flex: 1;
    }
    .action {
      border: 0;
      background: none;
      padding: 2px 6px;
      border-radius: var(--tk-radius-sm);
      color: var(--tk-accent-fg);
      font-weight: var(--tk-weight-medium);
      cursor: pointer;
    }
    .action:hover {
      background: var(--tk-bg-hover);
    }
  `,
})
export class ToastComponent {
  protected readonly data = inject<ToastData>(MAT_SNACK_BAR_DATA);
  protected readonly ref = inject(MatSnackBarRef);
  protected readonly icon = ICONS[this.data.intent];

  protected run(action: () => void): void {
    this.ref.dismissWithAction();
    action();
  }
}
