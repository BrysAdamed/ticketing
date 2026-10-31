import { inject } from '@angular/core';
import { CanMatchFn } from '@angular/router';
import { FLAG_ON, FeatureFlagService } from './feature-flag.service';
import { FlagKey } from './flag-keys';

/// Route matches only while the flag evaluates to `variant` (default `on`); otherwise the router
/// falls through to the next matching route.
export function featureGuard(flagKey: FlagKey, variant: string = FLAG_ON): CanMatchFn {
  return () => inject(FeatureFlagService).variant(flagKey) === variant;
}
