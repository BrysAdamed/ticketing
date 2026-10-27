import { DestroyRef, EnvironmentProviders, inject, provideEnvironmentInitializer } from '@angular/core';
import { CommandRegistry } from '@core/commands/command-registry';
import { quickJumpProviders } from './quick-jump';

/// App-wide search contributions: the command palette's key jump, quick-jump lookup and "Search for…".
export function provideSearch(): EnvironmentProviders {
  return provideEnvironmentInitializer(() => {
    const registry = inject(CommandRegistry);
    const destroyRef = inject(DestroyRef);
    for (const provider of quickJumpProviders()) registry.registerSearchProvider(provider, destroyRef);
  });
}
