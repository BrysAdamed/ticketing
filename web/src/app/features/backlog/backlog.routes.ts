import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { BACKLOG_VIEW } from './backlog.views';

export default [viewRoute(BACKLOG_VIEW, { path: '' })] satisfies Routes;
