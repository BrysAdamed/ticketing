export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

/// The zoom steps the buttons and `+`/`-` move through.
export const ZOOM_STEPS = [0.1, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4] as const;

/// The scale that fits a `width` × `height` diagram into the available box, never enlarging it
/// beyond its natural size; 1 while the box is not measured yet.
export function fitScale(
  width: number,
  height: number,
  availableWidth: number,
  availableHeight: number,
): number {
  if (width <= 0 || height <= 0 || availableWidth <= 0 || availableHeight <= 0) return 1;
  return Math.max(ZOOM_MIN, Math.min(1, availableWidth / width, availableHeight / height));
}

/// The next step above (`direction` 1) or below (-1) `scale`; a scale between steps moves to the
/// nearest step in that direction.
export function nextZoom(scale: number, direction: 1 | -1): number {
  const epsilon = 0.001;
  if (direction > 0) return ZOOM_STEPS.find((step) => step > scale + epsilon) ?? ZOOM_MAX;
  return [...ZOOM_STEPS].reverse().find((step) => step < scale - epsilon) ?? ZOOM_MIN;
}
