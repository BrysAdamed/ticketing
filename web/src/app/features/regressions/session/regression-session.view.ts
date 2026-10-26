import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { RegressionSessionStore } from './regression-session.store';

@Component({
  selector: 'tk-regression-session-view',
  imports: [PagePlaceholderComponent],
  providers: [RegressionSessionStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-regressions.session' },
  template: `
    <header class="tk-page-header">
      <h1>Regression session</h1>
    </header>
    <tk-page-placeholder
      icon="tablerHistory"
      title="Regression session"
      viewId="regressions.session"
      description="Execute the test cases of a regression session."
    />
  `,
})
export class RegressionSessionView {
  protected readonly store = inject(RegressionSessionStore);
  readonly projectKey = input.required<string>();
  readonly sessionKey = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ projectKey: this.projectKey(), sessionKey: this.sessionKey() });
    });
  }
}
