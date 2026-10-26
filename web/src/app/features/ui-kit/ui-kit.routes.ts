import { Routes } from '@angular/router';
import { defineView } from '@core/views/view-definition';
import { viewRoute } from '@core/views/view-registry';

export const UI_KIT_VIEW = defineView({
  viewId: 'dev.ui-kit',
  variants: { default: () => import('./ui-kit.view').then((m) => m.UiKitView) },
});

export default [viewRoute(UI_KIT_VIEW, { path: '' })] satisfies Routes;
