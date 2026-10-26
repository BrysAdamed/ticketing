import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { SEARCH_VIEW } from './search.views';

export default [viewRoute(SEARCH_VIEW, { path: '' })] satisfies Routes;
