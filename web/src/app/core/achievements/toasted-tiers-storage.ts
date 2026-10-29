/// The `localStorage` key of a user's toasted achievement tiers (D-152).
export function toastedTiersKey(userId: string): string {
  return `tk.achievements.toasted.${userId}`;
}

/// The document's `localStorage`, or null when it is missing or throws.
export function localStorageOf(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}

/// Drops the user's toasted tiers, so a tier earned again later toasts again. Kept apart from
/// `ToastedTiers` so the eager unlock poller does not load the rest.
export function forgetToastedTiers(document: Document, userId: string): void {
  try {
    localStorageOf(document)?.removeItem(toastedTiersKey(userId));
  } catch {
    return;
  }
}
