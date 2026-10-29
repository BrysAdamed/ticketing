import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { IconComponent } from '../icon/icon.component';

/// An inline hint (onboarding.html, "Inline hints"): an info icon, a bold lead-in, a muted sentence,
/// an optional "Learn more" action and a dismiss button. Part of the page, never an overlay.
/// `compact` is the smaller form for a picker footer, dismissed with an icon button.
@Component({
  selector: 'tk-hint',
  imports: [IconComponent, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'note', '[class.compact]': 'compact()' },
  template: `
    <tk-icon class="icon" name="tablerInfoCircle" [size]="compact() ? 14 : 16" />
    <p class="text">
      <b>{{ title() }}</b
      >&ngsp;<span>{{ body() }}</span>
    </p>
    <div class="actions">
      @if (learnMoreLabel(); as label) {
        <button mat-button type="button" data-testid="hint-learn-more" (click)="learnMore.emit()">
          {{ label }}
        </button>
      }
      @if (compact()) {
        <button
          type="button"
          class="tk-icon-btn tk-icon-btn-sm"
          aria-label="Dismiss hint"
          data-testid="hint-dismiss"
          (mousedown)="$event.preventDefault()"
          (click)="dismissed.emit()"
        >
          <tk-icon name="tablerX" [size]="12" />
        </button>
      } @else {
        <button
          mat-button
          type="button"
          aria-label="Got it, dismiss hint"
          data-testid="hint-dismiss"
          (click)="dismissed.emit()"
        >
          Got it
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      padding: 6px 8px 6px 12px;
      border: 1px solid var(--tk-info-border);
      background: var(--tk-info-bg);
      border-radius: var(--tk-radius-md);
      color: var(--tk-text);
    }
    .icon {
      flex: none;
      margin-top: 6px;
      color: var(--tk-info-fg);
    }
    .text {
      flex: 1;
      min-width: 0;
      margin: 4px 0;
    }
    b {
      font-weight: var(--tk-weight-semibold);
    }
    span {
      color: var(--tk-text-muted);
    }
    .actions {
      display: flex;
      flex: none;
      gap: 2px;
      align-items: center;
    }
    :host(.compact) {
      gap: 8px;
      padding: 6px 4px 6px 10px;
      font-size: var(--tk-text-sm);
      line-height: var(--tk-leading-sm);
    }
    :host(.compact) .icon {
      margin-top: 2px;
    }
    :host(.compact) .text {
      margin: 0;
    }
  `,
})
export class HintComponent {
  readonly title = input.required<string>();
  readonly body = input.required<string>();
  readonly learnMoreLabel = input<string | null>(null);
  readonly compact = input(false);

  readonly dismissed = output<void>();
  readonly learnMore = output<void>();
}
