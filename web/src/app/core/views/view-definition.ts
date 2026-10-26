import { Type } from '@angular/core';

export const DEFAULT_VARIANT = 'default';

export type ViewModule = Type<unknown> | { default: Type<unknown> };
export type ViewLoader = () => Promise<ViewModule>;

/// A routed page (or panel) addressable by a stable view id, the seam for A/B variants
/// (spec 6.13, D-14). `variants.default` is required. When `flag` is set, the registry renders
/// the variant whose name equals the flag's evaluated variant and falls back to `default`.
export interface ViewDefinition {
  readonly viewId: string;
  readonly flag?: string;
  readonly variants: Readonly<{ default: ViewLoader } & Record<string, ViewLoader>>;
}

export interface ViewExposure {
  readonly viewId: string;
  readonly variant: string;
  readonly flag?: string;
}

export type ViewExposureListener = (exposure: ViewExposure) => void;

const VIEW_ID_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

export function defineView(definition: ViewDefinition): ViewDefinition {
  if (!VIEW_ID_PATTERN.test(definition.viewId)) {
    throw new Error(
      `View id "${definition.viewId}" must look like "area.view" (lower-case, dotted).`,
    );
  }
  return definition;
}
