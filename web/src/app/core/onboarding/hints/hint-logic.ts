import { HintDefinition } from '../guides/hints';

/// One place on the page that may show a hint, as the visibility rules see it.
export interface HintCandidate {
  readonly token: number;
  readonly hint: HintDefinition;
  readonly canWrite: boolean;
  /// A dialog, menu or picker other than the one the hint sits in is open.
  readonly coveredByOverlay: boolean;
}

export interface HintConditions {
  /// The onboarding state has loaded, so `isSeen` can be trusted.
  readonly loaded: boolean;
  readonly tourRunning: boolean;
  readonly isSeen: (guideId: string, version: number) => boolean;
}

/// The token of the one hint to show (spec 14.5): nothing until the state is known or while a tour
/// runs; otherwise the first registered candidate that is unseen at its version, allowed for the
/// user and not covered by another overlay.
export function visibleHint(
  candidates: readonly HintCandidate[],
  conditions: HintConditions,
): number | null {
  if (!conditions.loaded || conditions.tourRunning) return null;
  const shown = candidates.find(
    ({ hint, canWrite, coveredByOverlay }) =>
      !coveredByOverlay &&
      (hint.requires !== 'write' || canWrite) &&
      !conditions.isSeen(hint.id, hint.version),
  );
  return shown?.token ?? null;
}

/// Whether an open backdrop other than the one of the overlay `element` sits in covers it.
export function isCoveredByOverlay(element: Element, openBackdrops: readonly Element[]): boolean {
  const own = ownBackdrop(element);
  return openBackdrops.some((backdrop) => backdrop !== own);
}

/// The backdrop of the overlay `element` sits in, if any. A popover overlay host holds its backdrop
/// as a child; otherwise the CDK inserts the backdrop right before the host. The pane's parent is
/// the host or, for connected positions, a bounding box inside it.
function ownBackdrop(element: Element): Element | null {
  let node = element.closest('.cdk-overlay-pane')?.parentElement ?? null;
  for (let depth = 0; node && depth < 2; depth++, node = node.parentElement) {
    if (node.classList.contains('cdk-overlay-popover'))
      return Array.from(node.children).find(isBackdrop) ?? null;
    const before = node.previousElementSibling;
    if (before && isBackdrop(before)) return before;
  }
  return null;
}

function isBackdrop(element: Element): boolean {
  return element.classList.contains('cdk-overlay-backdrop');
}

/// Backdrops that are open: the CDK turns off pointer events on a backdrop while it detaches.
export function openBackdrops(container: ParentNode): Element[] {
  return Array.from(container.querySelectorAll<HTMLElement>('.cdk-overlay-backdrop')).filter(
    (backdrop) => backdrop.style.pointerEvents !== 'none',
  );
}
