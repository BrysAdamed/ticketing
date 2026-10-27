import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { BoardDirectory } from '@core/boards/board-directory';
import { PAGE_TITLE_DATA_KEY } from '@core/layout/page-title';
import { viewRoute } from '@core/views/view-registry';
import { BOARD_VIEW, BOARDS_LIST_VIEW } from './boards.views';

const boardTitle = (route: ActivatedRouteSnapshot) => {
  const id = route.paramMap.get('boardId');
  return inject(BoardDirectory).boards().find((b) => b.id === id)?.name ?? 'Board';
};

export default [
  viewRoute(BOARDS_LIST_VIEW, { path: '' }),
  viewRoute(BOARD_VIEW, { path: ':boardId', data: { [PAGE_TITLE_DATA_KEY]: boardTitle } }),
] satisfies Routes;
