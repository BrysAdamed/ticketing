import { defineView } from '@core/views/view-definition';

export const PROJECT_SETTINGS_LAYOUT_VIEW = defineView({
  viewId: 'project.settings.layout',
  variants: {
    default: () =>
      import('./layout/project-settings-layout.view').then((m) => m.ProjectSettingsLayoutView),
  },
});

export const PROJECT_SETTINGS_VIEW = defineView({
  viewId: 'project.settings',
  variants: {
    default: () => import('./project-settings.view').then((m) => m.ProjectSettingsView),
  },
});

export const PROJECT_AGENT_SETTINGS_VIEW = defineView({
  viewId: 'project.settings.agent',
  variants: {
    default: () => import('./agent/agent-settings.view').then((m) => m.AgentSettingsView),
  },
});

export const PROJECT_AGENT_PROMPT_VIEW = defineView({
  viewId: 'project.settings.agent-prompt',
  variants: {
    default: () => import('./agent/agent-prompt-editor.view').then((m) => m.AgentPromptEditorView),
  },
});
