import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { AGENT_FLAG } from '@core/flags/flag-keys';
import { promptSlotFromSlug, promptSlotLabel } from '@core/agent/prompt-slugs';
import { featureGuard } from '@core/flags/feature.guard';
import { unsavedChangesGuard } from '@core/layout/unsaved-changes.guard';
import { viewRoute } from '@core/views/view-registry';
import {
  ADMIN_LAYOUT_VIEW,
  ADMIN_USERS_VIEW,
  AGENT_PROMPTS_VIEW,
  AUDIT_LOG_VIEW,
  FEATURE_FLAGS_VIEW,
  INSTANCE_AGENT_PROMPT_VIEW,
} from './admin.views';

const slotCrumb = (route: ActivatedRouteSnapshot) => {
  const slot = promptSlotFromSlug(route.paramMap.get('slot'));
  return slot ? promptSlotLabel(slot) : 'Prompt';
};

/// Agent prompts (`agent-prompts`, `agent-prompts/:slot` with `bug`, `user-story`, …, `guardrails`)
/// exist only while `agent.delegate` is on for the Admin.
export default [
  viewRoute(ADMIN_LAYOUT_VIEW, {
    path: '',
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'users' },
      viewRoute(ADMIN_USERS_VIEW, { path: 'users', title: 'Users', data: { breadcrumb: 'Users' } }),
      viewRoute(FEATURE_FLAGS_VIEW, {
        path: 'flags',
        title: 'Feature flags',
        data: { breadcrumb: 'Feature flags' },
      }),
      {
        path: 'agent-prompts',
        title: 'Agent prompts',
        data: { breadcrumb: 'Agent prompts' },
        canMatch: [featureGuard(AGENT_FLAG)],
        children: [
          viewRoute(AGENT_PROMPTS_VIEW, { path: '' }),
          viewRoute(INSTANCE_AGENT_PROMPT_VIEW, {
            path: ':slot',
            title: (route) => `${slotCrumb(route)} · Agent prompts`,
            data: { breadcrumb: slotCrumb },
            canDeactivate: [unsavedChangesGuard],
          }),
        ],
      },
      viewRoute(AUDIT_LOG_VIEW, {
        path: 'audit',
        title: 'Audit log',
        data: { breadcrumb: 'Audit log' },
      }),
    ],
  }),
] satisfies Routes;
