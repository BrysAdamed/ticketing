import {
  DestroyRef,
  EnvironmentProviders,
  inject,
  provideEnvironmentInitializer,
} from '@angular/core';
import { CommandRegistry } from '@core/commands/command-registry';
import { QUICK_JUMP_SCOPES, quickJumpProviders } from './quick-jump';

/// App-wide search contributions: the command palette's key jump, quick-jump lookup, "Search for…"
/// and the `p:` / `t:` scope prefixes.
export function provideSearch(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const registry = inject(CommandRegistry);
    const destroyRef = inject(DestroyRef);
    for (const provider of quickJumpProviders())
      registry.registerSearchProvider(provider, destroyRef);
    for (const scope of QUICK_JUMP_SCOPES) registry.registerScope(scope, destroyRef);
  });
}
