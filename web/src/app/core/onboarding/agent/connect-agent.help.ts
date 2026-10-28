import { EnvironmentProviders, inject } from '@angular/core';
import { Router } from '@angular/router';
import { HELP_MENU_ORDER } from '../../help/help-menu';
import { provideHelpMenuItem } from '../../help/help-menu.registry';
import { CONNECT_AGENT_HELP_ID, CONNECT_AGENT_PATH, CONNECT_AGENT_QUERY } from './connect-agent';

/// Help → Connect an AI agent (spec 14.6, 14.8): opens the agent guide on the access tokens page.
export function provideConnectAgentHelp(): EnvironmentProviders {
  return provideHelpMenuItem(() => {
    const router = inject(Router);
    return {
      id: CONNECT_AGENT_HELP_ID,
      label: 'Connect an AI agent',
      icon: 'tablerPlug',
      order: HELP_MENU_ORDER.connectAgent,
      keywords: ['mcp', 'claude code', 'access token', 'pat'],
      run: () =>
        void router.navigate([...CONNECT_AGENT_PATH], { queryParams: CONNECT_AGENT_QUERY }),
    };
  });
}
