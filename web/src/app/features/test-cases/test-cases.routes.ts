import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { TEST_CASES_VIEW } from './test-cases.views';

export default [viewRoute(TEST_CASES_VIEW, { path: '' })] satisfies Routes;
