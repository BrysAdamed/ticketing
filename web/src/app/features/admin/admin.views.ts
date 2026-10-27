import { defineView } from '@core/views/view-definition';

export const ADMIN_LAYOUT_VIEW = defineView({
  viewId: 'admin.layout',
  variants: { default: () => import('./layout/admin-layout.view').then((m) => m.AdminLayoutView) },
});

export const ADMIN_USERS_VIEW = defineView({
  viewId: 'admin.users',
  variants: { default: () => import('./users/admin-users.view').then((m) => m.AdminUsersView) },
});

export const FEATURE_FLAGS_VIEW = defineView({
  viewId: 'admin.flags',
  variants: { default: () => import('./flags/feature-flags.view').then((m) => m.FeatureFlagsView) },
});

export const AUDIT_LOG_VIEW = defineView({
  viewId: 'admin.audit',
  variants: { default: () => import('./audit/audit-log.view').then((m) => m.AuditLogView) },
});

export const AGENT_PROMPTS_VIEW = defineView({
  viewId: 'admin.agent-prompts',
  variants: {
    default: () => import('./agent-prompts/agent-prompts.view').then((m) => m.AgentPromptsView),
  },
});

export const INSTANCE_AGENT_PROMPT_VIEW = defineView({
  viewId: 'admin.agent-prompt',
  variants: {
    default: () =>
      import('./agent-prompts/instance-prompt-editor.view').then((m) => m.InstancePromptEditorView),
  },
});
