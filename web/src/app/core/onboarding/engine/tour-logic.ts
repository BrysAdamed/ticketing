import { TourAccess, TourDefinition, TourRequirement, TourStep } from './tour.model';

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
  return meetsRequirement(step.requires, access);
}

export function meetsRequirement(
  requires: TourRequirement | undefined,
  access: TourAccess,
): boolean {
  switch (requires) {
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
  const isLocal = (step: TourStep) => {
    if (!step.route) return true;
    const path = tryFillRoute(step.route, context.params);
    return path !== null && isOnPath(context.url, path);
  };
  const local = allowed.filter(isLocal);
  const skipped = local.filter((step) => !isActionStep(step) && !context.hasAnchor(step.anchor));
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

/// `fillRoute`, or null while a placeholder has no value yet (a walkthrough learns its params as
/// the user creates things).
export function tryFillRoute(
  pattern: string,
  params: Readonly<Record<string, string>>,
): string | null {
  try {
    return fillRoute(pattern, params);
  } catch {
    return null;
  }
}

/// Whether the step waits for the user's action instead of Next.
export function isActionStep(step: TourStep): boolean {
  return step.advanceWhen !== undefined;
}

/// Where step `index` stands for "Step n of m": steps that share a `stage` count as one.
export function stageProgress(
  steps: readonly TourStep[],
  index: number,
): { readonly current: number; readonly total: number } {
  const keys = steps.map((step, i) => step.stage ?? `#${i}`);
  const stages = [...new Set(keys)];
  return { current: stages.indexOf(keys[index]), total: stages.length };
}

/// Replaces `{name}` placeholders in step copy with the tour's params; unknown ones stay as typed.
export function fillText(text: string, params: Readonly<Record<string, string>>): string {
  return text.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (match, name: string) => params[name] ?? match);
}

/// Where a walkthrough resumes (spec 14.4): the first step whose condition does not hold. Steps
/// without a condition (Next-driven ones) never hold. An optional step is passed over when a later
/// step already holds, or always with `skipOptional` (an entry point that starts further on).
/// `holds[i]` is for `steps[i]`; returns `steps.length` when everything holds.
export function resumeIndex(
  steps: readonly TourStep[],
  holds: readonly boolean[],
  options: { readonly skipOptional?: boolean } = {},
): number {
  for (let i = 0; i < steps.length; i++) {
    if (holds[i]) continue;
    const laterHolds = holds.slice(i + 1).some(Boolean);
    if (steps[i].optional && (options.skipOptional || laterHolds)) continue;
    return i;
  }
  return steps.length;
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
