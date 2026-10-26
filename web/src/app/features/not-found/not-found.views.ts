import { defineView } from '@core/views/view-definition';

export const NOT_FOUND_VIEW = defineView({
  viewId: 'app.not-found',
  variants: { default: () => import('./not-found.view').then((m) => m.NotFoundView) },
});
