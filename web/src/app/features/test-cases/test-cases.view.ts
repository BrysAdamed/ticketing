import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { TestCasesStore } from './test-cases.store';

@Component({
  selector: 'tk-test-cases-view',
  imports: [PagePlaceholderComponent],
  providers: [TestCasesStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-testcases.list' },
  template: `
    <header class="tk-page-header">
      <h1>Test cases</h1>
    </header>
    <tk-page-placeholder
      icon="tablerChecklist"
      title="Test cases"
      viewId="testcases.list"
      description="Manual and automatic test cases of this project."
    />
  `,
})
export class TestCasesView {
  protected readonly store = inject(TestCasesStore);
  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ projectKey: this.projectKey() });
    });
  }
}
