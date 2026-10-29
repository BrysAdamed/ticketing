const KEY_PREFIX = 'tk.achievements.toasted.';

/// The achievement tiers (`id:tier`) already toasted, per user in `localStorage` (D-152). Storage
/// that is missing or throws reads as empty and ignores writes.
export class ToastedTiers {
  private readonly storage: Storage | null;

  constructor(document: Document) {
    this.storage = localStorageOf(document);
  }

  read(userId: string): string[] {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(KEY_PREFIX + userId) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  write(userId: string, keys: readonly string[]): void {
    if (keys.length === 0) {
      this.forget(userId);
      return;
    }
    try {
      this.storage?.setItem(KEY_PREFIX + userId, JSON.stringify(keys));
    } catch {
      return;
    }
  }

  forget(userId: string): void {
    try {
      this.storage?.removeItem(KEY_PREFIX + userId);
    } catch {
      return;
    }
  }
}

function localStorageOf(document: Document): Storage | null {
  try {
    return document.defaultView?.localStorage ?? null;
  } catch {
    return null;
  }
}
