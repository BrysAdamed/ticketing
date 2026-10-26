import {
  inject,
  Injectable,
  InjectionToken,
  isDevMode,
  makeEnvironmentProviders,
  Type,
} from '@angular/core';
import { ActivationEnd, Route, Router } from '@angular/router';
import { filter } from 'rxjs';
import { FeatureFlagService } from '../flags/feature-flag.service';
import {
  DEFAULT_VARIANT,
  ViewDefinition,
  ViewExposure,
  ViewExposureListener,
  ViewModule,
} from './view-definition';

export const VIEW_ID_DATA_KEY = 'viewId';

export const VIEW_EXPOSURE_LISTENERS = new InjectionToken<readonly ViewExposureListener[]>(
  'VIEW_EXPOSURE_LISTENERS',
  { factory: () => [] },
);

/// Registers a callback invoked every time a view is shown, with the variant that was rendered.
/// This is the hook for future A/B exposure analytics.
export function provideViewExposure(listener: ViewExposureListener) {
  return makeEnvironmentProviders([
    { provide: VIEW_EXPOSURE_LISTENERS, useValue: listener, multi: true },
  ]);
}

/// Resolves view ids to components, picking the variant from the view's feature flag.
@Injectable({ providedIn: 'root' })
export class ViewRegistry {
  private readonly flags = inject(FeatureFlagService);
  private readonly listeners = inject(VIEW_EXPOSURE_LISTENERS);
  private readonly definitions = new Map<string, ViewDefinition>();
  private readonly renderedVariants = new Map<string, string>();

  constructor() {
    inject(Router)
      .events.pipe(filter((event): event is ActivationEnd => event instanceof ActivationEnd))
      .subscribe((event) => {
        const viewId = event.snapshot.routeConfig?.data?.[VIEW_ID_DATA_KEY] as string | undefined;
        if (viewId) this.reportExposure(viewId);
      });
  }

  get viewIds(): readonly string[] {
    return [...this.definitions.keys()];
  }

  register(definition: ViewDefinition): void {
    const existing = this.definitions.get(definition.viewId);
    if (existing && existing !== definition && isDevMode()) {
      console.warn(`View "${definition.viewId}" is defined more than once.`);
    }
    this.definitions.set(definition.viewId, definition);
  }

  selectVariant(definition: ViewDefinition): string {
    if (!definition.flag) return DEFAULT_VARIANT;
    const variant = this.flags.variant(definition.flag);
    return Object.hasOwn(definition.variants, variant) ? variant : DEFAULT_VARIANT;
  }

  async resolve(definition: ViewDefinition): Promise<Type<unknown>> {
    this.register(definition);
    const variant = this.selectVariant(definition);
    try {
      const component = unwrap(await definition.variants[variant]());
      this.renderedVariants.set(definition.viewId, variant);
      return component;
    } catch (error) {
      if (variant === DEFAULT_VARIANT) throw error;
      console.error(`View "${definition.viewId}" variant "${variant}" failed to load.`, error);
      this.renderedVariants.set(definition.viewId, DEFAULT_VARIANT);
      return unwrap(await definition.variants.default());
    }
  }

  reportExposure(viewId: string): void {
    const definition = this.definitions.get(viewId);
    const exposure: ViewExposure = {
      viewId,
      variant: this.renderedVariants.get(viewId) ?? DEFAULT_VARIANT,
      flag: definition?.flag,
    };
    for (const listener of this.listeners) {
      try {
        listener(exposure);
      } catch (error) {
        console.error('View exposure listener failed.', error);
      }
    }
  }
}

/// Builds a lazy route whose component is resolved through the view registry. The variant is
/// chosen on first navigation and then cached by the router for the rest of the session.
export function viewRoute(
  definition: ViewDefinition,
  route: Omit<Route, 'component' | 'loadComponent'> = {},
): Route {
  return {
    ...route,
    data: { ...route.data, [VIEW_ID_DATA_KEY]: definition.viewId },
    loadComponent: () => inject(ViewRegistry).resolve(definition),
  };
}

function unwrap(module: ViewModule): Type<unknown> {
  return typeof module === 'function' ? module : module.default;
}
