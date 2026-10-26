import { defineView } from '@core/views/view-definition';

export const PROJECT_SETTINGS_VIEW = defineView({
  viewId: 'project.settings',
  variants: {
    default: () => import('./project-settings.view').then((m) => m.ProjectSettingsView),
  },
});
