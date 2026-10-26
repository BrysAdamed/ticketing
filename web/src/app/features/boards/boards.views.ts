import { defineView } from '@core/views/view-definition';

export const BOARDS_LIST_VIEW = defineView({
  viewId: 'boards.list',
  variants: { default: () => import('./list/boards.view').then((m) => m.BoardsView) },
});

export const BOARD_VIEW = defineView({
  viewId: 'board.kanban',
  variants: { default: () => import('./board/board.view').then((m) => m.BoardView) },
});
