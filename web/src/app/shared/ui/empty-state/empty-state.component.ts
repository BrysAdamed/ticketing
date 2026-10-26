import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

/// Centered empty / error state: 32px icon, title, one muted sentence and projected actions.
@Component({
  selector: 'tk-empty-state',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[class.danger]': 'tone() === "danger"' },
  template: `
    <tk-icon class="icon" [name]="icon()" [size]="32" />
    <h2>{{ title() }}</h2>
    @if (description()) {
      <p>{{ description() }}</p>
    }
    <div class="actions"><ng-content /></div>
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
      gap: 8px;
      align-items: center;
      margin-top: 16px;
    }
    .actions:empty {
      display: none;
    }
  `,
})
export class EmptyStateComponent {
  readonly icon = input('tablerInbox');
  readonly title = input.required<string>();
  readonly description = input<string | null>(null);
  readonly tone = input<'neutral' | 'danger'>('neutral');
}
