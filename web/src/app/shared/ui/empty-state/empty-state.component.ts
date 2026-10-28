import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { IconComponent } from '../icon/icon.component';

/// Centered empty / error state: 32px icon, title, one muted sentence, projected actions and an
/// optional secondary learn action (spec 14.7) that emits `learn`; the page decides what it starts.
@Component({
  selector: 'tk-empty-state',
  imports: [IconComponent, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.danger]': 'tone() === "danger"' },
  template: `
    <tk-icon class="icon" [name]="icon()" [size]="32" />
    <h2>{{ title() }}</h2>
    @if (description()) {
      <p>{{ description() }}</p>
    }
    <div class="actions">
      <ng-content />
      @if (learnLabel(); as label) {
        <button
          mat-stroked-button
          type="button"
          data-testid="empty-state-learn"
          (click)="learn.emit()"
        >
          <tk-icon class="learn-icon" name="tablerCompass" [size]="14" />
          {{ label }}
        </button>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      max-width: 360px;
      margin: 64px auto;
      padding: 0 16px;
    }
    .icon {
      color: var(--tk-text-subtle);
      margin-bottom: 12px;
    }
    :host(.danger) .icon {
      color: var(--tk-danger);
    }
    h2 {
      margin: 0 0 4px;
      font-size: var(--tk-text-lg);
      line-height: var(--tk-leading-lg);
      font-weight: var(--tk-weight-semibold);
    }
    p {
      margin: 0;
      color: var(--tk-text-muted);
    }
    .actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: 8px;
      align-items: center;
      margin-top: 16px;
    }
    .actions:empty {
      display: none;
    }
    .learn-icon {
      margin-right: 6px;
      vertical-align: -2px;
    }
  `,
})
export class EmptyStateComponent {
  readonly icon = input('tablerInbox');
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  readonly tone = input<'neutral' | 'danger'>('neutral');
  /// Label of the secondary learn action ("Take the tour"); null hides it.
  readonly learnLabel = input<string | null>(null);
  readonly learn = output<void>();
}
