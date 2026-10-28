import { TourAccess, TourDefinition, TourStep } from './tour.model';

export interface TourPlan {
  /// Steps to show, in order.
  readonly steps: readonly TourStep[];
  /// Steps on the current route whose anchor is missing (warned about in dev mode).
  readonly skipped: readonly TourStep[];
  /// Fewer than half of the current route's anchors resolved: the view changed under the tour,
  /// so it is not started at all.
  readonly abort: boolean;
}

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export function isAllowed(step: TourStep, access: TourAccess): boolean {
  switch (step.requires) {
    case 'write':
      return access.canWrite;
    case 'owner':
      return access.isOwner;
    case 'admin':
      return access.isAdmin;
    default:
      return true;
  }
}

/// Fills `:param` placeholders of a step route. Throws when a placeholder has no value, because a
/// tour started without its params is a programming error.
export function fillRoute(pattern: string, params: Readonly<Record<string, string>>): string {
  return pattern.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Tour route "${pattern}" needs the "${name}" param.`);
    return encodeURIComponent(value);
  });
}

/// Whether `url` (path, optional query and fragment) is the page `path` points at.
export function isOnPath(url: string, path: string): boolean {
  const bare = (value: string) => value.split(/[?#]/)[0].replace(/\/+$/, '').toLowerCase();
  return bare(url) === bare(path);
}

/// Picks the steps to show: role filter first, then anchors. Steps that live on another route are
/// kept, their anchors are checked once the engine has navigated there.
export function planTour(
  tour: TourDefinition,
  access: TourAccess,
  context: {
    readonly url: string;
    readonly params: Readonly<Record<string, string>>;
    readonly hasAnchor: (anchor: string) => boolean;
  },
): TourPlan {
  const allowed = tour.steps.filter((step) => isAllowed(step, access));
  const isLocal = (step: TourStep) =>
    !step.route || isOnPath(context.url, fillRoute(step.route, context.params));
  const local = allowed.filter(isLocal);
  const skipped = local.filter((step) => !context.hasAnchor(step.anchor));
  const resolved = local.length - skipped.length;
  return {
    steps: allowed.filter((step) => !skipped.includes(step)),
    skipped,
    abort: allowed.length === 0 || (local.length > 0 && resolved * 2 < local.length),
  };
}

export function stepLabel(index: number, total: number): string {
  return `Step ${index + 1} of ${total}`;
}

/// The spotlight hole around an anchor: the anchor's box grown by `padding`, clipped to the
/// viewport. `null` when the anchor is not visible (no size, or entirely off-screen).
export function spotlightHole(
  rect: Box,
  viewport: { readonly width: number; readonly height: number },
  padding: number,
): Box | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(viewport.width, rect.x + rect.width + padding);
  const bottom = Math.min(viewport.height, rect.y + rect.height + padding);
  if (right <= left || bottom <= top) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}
