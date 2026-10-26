import { defineView } from '@core/views/view-definition';

export const PROJECTS_LIST_VIEW = defineView({
  viewId: 'projects.list',
  variants: { default: () => import('./list/projects-list.view').then((m) => m.ProjectsListView) },
});

export const PROJECT_LAYOUT_VIEW = defineView({
  viewId: 'project.layout',
  variants: {
    default: () => import('./layout/project-layout.view').then((m) => m.ProjectLayoutView),
  },
});
