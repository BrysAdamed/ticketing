import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { BoardsStore } from './boards.store';

@Component({
  selector: 'tk-boards-view',
  imports: [PagePlaceholderComponent],
  providers: [BoardsStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-boards.list' },
  template: `
    <header class="tk-page-header">
      <h1>Boards</h1>
    </header>
    <tk-page-placeholder
      icon="tablerLayoutKanban"
      title="Boards"
      viewId="boards.list"
      description="Boards span projects; pull tickets from backlogs onto a board."
    />
  `,
})
export class BoardsView {
  protected readonly store = inject(BoardsStore);

  constructor() {
    this.store.load();
  }
}
