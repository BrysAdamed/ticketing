import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { RegressionsStore } from './regressions.store';

@Component({
  selector: 'tk-regressions-view',
  imports: [PagePlaceholderComponent],
  providers: [RegressionsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-regressions.list' },
  template: `
    <header class="tk-page-header">
      <h1>Regressions</h1>
    </header>
    <tk-page-placeholder
      icon="tablerHistory"
      title="Regressions"
      viewId="regressions.list"
      description="Regression sessions and their results."
    />
  `,
})
export class RegressionsView {
  protected readonly store = inject(RegressionsStore);
  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ projectKey: this.projectKey() });
    });
  }
}
