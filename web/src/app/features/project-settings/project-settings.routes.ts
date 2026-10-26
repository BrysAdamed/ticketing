import { Routes } from '@angular/router';
import { viewRoute } from '@core/views/view-registry';
import { PROJECT_SETTINGS_VIEW } from './project-settings.views';

export default [viewRoute(PROJECT_SETTINGS_VIEW, { path: '' })] satisfies Routes;
