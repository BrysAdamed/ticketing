import { defineView } from '@core/views/view-definition';

export const MY_WORK_VIEW = defineView({
  viewId: 'my-work.list',
  variants: { default: () => import('./my-work.view').then((m) => m.MyWorkView) },
});
