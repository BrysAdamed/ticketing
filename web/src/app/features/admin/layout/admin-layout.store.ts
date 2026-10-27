import { computed, inject, Injectable } from '@angular/core';
import { AGENT_FLAG } from '@core/agent/agent-prompt.models';
import { FeatureFlagService } from '@core/flags/feature-flag.service';
import { RouteTab } from '@shared/ui/route-tabs/route-tabs.component';

/// Admin sections. Agent prompts sits next to Feature flags and appears only while `agent.delegate`
/// is on for the Admin.
@Injectable()
export class AdminLayoutStore {
  private readonly flags = inject(FeatureFlagService);

  readonly title = 'Admin';

  readonly tabs = computed<readonly RouteTab[]>(() => [
    { path: 'users', label: 'Users' },
    { path: 'flags', label: 'Feature flags' },
    ...(this.flags.isOn(AGENT_FLAG) ? [{ path: 'agent-prompts', label: 'Agent prompts' }] : []),
    { path: 'audit', label: 'Audit log' },
  ]);
}
