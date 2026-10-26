import { defineView } from '@core/views/view-definition';

export const BACKLOG_VIEW = defineView({
  viewId: 'backlog.list',
  variants: { default: () => import('./backlog.view').then((m) => m.BacklogView) },
});
