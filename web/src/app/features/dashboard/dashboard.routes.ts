import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { DASHBOARD_VIEW } from './dashboard.views';

export default [viewRoute(DASHBOARD_VIEW, { path: '' })] satisfies Routes;
