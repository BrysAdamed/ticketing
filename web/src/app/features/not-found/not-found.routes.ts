import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { NOT_FOUND_VIEW } from './not-found.views';

export default [viewRoute(NOT_FOUND_VIEW, { path: '' })] satisfies Routes;
