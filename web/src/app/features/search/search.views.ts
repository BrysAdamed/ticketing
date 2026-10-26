import { defineView } from '@core/views/view-definition';

export const SEARCH_VIEW = defineView({
  viewId: 'search.results',
  variants: { default: () => import('./search.view').then((m) => m.SearchView) },
});
