import { ChangeDetectionStrategy, Component, effect, input, inject } from '@angular/core';
import { PagePlaceholderComponent } from '@shared/ui/page-placeholder/page-placeholder.component';
import { BoardStore } from './board.store';

@Component({
  selector: 'tk-board-view',
  imports: [PagePlaceholderComponent],
  providers: [BoardStore],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'tk-page', 'data-testid': 'view-board.kanban' },
  template: `
    <header class="tk-page-header">
      <h1>Board</h1>
    </header>
    <tk-page-placeholder
      icon="tablerLayoutKanban"
      title="Board"
      viewId="board.kanban"
      description="Kanban board with one column per status."
    />
  `,
})
export class BoardView {
  protected readonly store = inject(BoardStore);
  readonly boardId = input.required<string>();

  constructor() {
    effect(() => {
      this.store.load({ boardId: this.boardId() });
    });
  }
}
