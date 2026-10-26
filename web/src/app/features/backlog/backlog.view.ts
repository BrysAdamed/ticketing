import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { BacklogStore } from './backlog.store';

@Component({
  selector: 'tk-backlog-view',
  imports: [PagePlaceholderComponent],
  providers: [BacklogStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-backlog.list' },
  template: `
    <header class="tk-page-header">
      <h1>Backlog</h1>
    </header>
    <tk-page-placeholder
      icon="tablerList"
      title="Backlog"
      viewId="backlog.list"
      description="Ranked tickets that are not on a board."
    />
  `,
})
export class BacklogView {
  protected readonly store = inject(BacklogStore);
  readonly projectKey = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ projectKey: this.projectKey() });
    });
  }
}
