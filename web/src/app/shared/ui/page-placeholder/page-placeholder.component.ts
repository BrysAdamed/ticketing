import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { EmptyStateComponent } from '../empty-state/empty-state.component';

/// Temporary body for pages whose feature is not built yet. Feature teams delete it from their
/// view when they implement the page.
@Component({
  selector: 'tk-page-placeholder',
  imports: [EmptyStateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { 'data-testid': 'page-placeholder' },
  template: `
    <tk-empty-state
      [icon]="icon()"
      [title]="title()"
      [description]="description() ?? 'This view is not built yet (view id ' + viewId() + ').'"
    >
      <ng-content />
    </tk-empty-state>
  `,
})
export class PagePlaceholderComponent {
  readonly title = input.required<string>();
  readonly viewId = input.required<string>();
  readonly icon = input('tablerFileText');
  readonly description = input<string | null>(null);
}
