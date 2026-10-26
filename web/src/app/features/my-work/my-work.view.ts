import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { MyWorkStore } from './my-work.store';

@Component({
  selector: 'tk-my-work-view',
  imports: [PagePlaceholderComponent],
  providers: [MyWorkStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-my-work.list' },
  template: `
    <header class="tk-page-header">
      <h1>My work</h1>
    </header>
    <tk-page-placeholder
      icon="tablerUserCircle"
      title="My work"
      viewId="my-work.list"
      description="Open tickets assigned to you across projects, grouped by project."
    />
  `,
})
export class MyWorkView {
  protected readonly store = inject(MyWorkStore);

  constructor() {
    this.store.load();
  }
}
