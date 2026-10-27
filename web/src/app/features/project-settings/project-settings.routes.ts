import { ActivatedRouteSnapshot, Routes } from '@angular/router';
import { AGENT_FLAG } from '@core/agent/agent-prompt.models';
import { promptTypeLabel } from '@core/agent/prompt-slugs';
import { featureGuard } from '@core/flags/feature.guard';
import { unsavedChangesGuard } from '@core/layout/unsaved-changes.guard';
import { viewRoute } from '@core/views/view-registry';
import {
  PROJECT_AGENT_PROMPT_VIEW,
  PROJECT_AGENT_SETTINGS_VIEW,
  PROJECT_SETTINGS_LAYOUT_VIEW,
  PROJECT_SETTINGS_VIEW,
} from './project-settings.views';

const promptCrumb = (route: ActivatedRouteSnapshot) =>
  promptTypeLabel(route.paramMap.get('ticketType')) ?? 'Prompt';

/// `/projects/:key/settings` (General) and the Agent tab: `settings/agent` and the prompt editor
/// `settings/agent/:ticketType` (`bug`, `user-story`, …), both only while `agent.delegate` is on.
export default [
  viewRoute(PROJECT_SETTINGS_LAYOUT_VIEW, {
    path: '',
    children: [
      viewRoute(PROJECT_SETTINGS_VIEW, { path: '' }),
      {
        path: 'agent',
        title: 'Agent',
        data: { breadcrumb: 'Agent' },
        canMatch: [featureGuard(AGENT_FLAG)],
        children: [
          viewRoute(PROJECT_AGENT_SETTINGS_VIEW, { path: '' }),
          viewRoute(PROJECT_AGENT_PROMPT_VIEW, {
            path: ':ticketType',
            title: (route) => `${promptCrumb(route)} prompt`,
            data: { breadcrumb: promptCrumb },
            canDeactivate: [unsavedChangesGuard],
          }),
        ],
      },
    ],
  }),
] satisfies Routes;
