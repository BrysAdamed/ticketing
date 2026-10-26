import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { MY_WORK_VIEW } from './my-work.views';

export default [viewRoute(MY_WORK_VIEW, { path: '' })] satisfies Routes;
