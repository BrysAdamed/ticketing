import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { BOARD_VIEW, BOARDS_LIST_VIEW } from './boards.views';

export default [
  viewRoute(BOARDS_LIST_VIEW, { path: '' }),
  viewRoute(BOARD_VIEW, { path: ':boardId', data: { breadcrumb: 'Board' } }),
] satisfies Routes;
