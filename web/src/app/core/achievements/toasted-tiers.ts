import { forgetToastedTiers, localStorageOf, toastedTiersKey } from './toasted-tiers-storage';

/// The achievement tiers (`id:tier`) already toasted, per user in `localStorage` (D-152). Storage
/// that is missing or throws reads as empty and ignores writes.
export class ToastedTiers {
  private readonly storage: Storage | null;

  constructor(private readonly document: Document) {
    this.storage = localStorageOf(document);
  }

  read(userId: string): string[] {
    try {
      const parsed: unknown = JSON.parse(this.storage?.getItem(toastedTiersKey(userId)) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter((k): k is string => typeof k === 'string') : [];
    } catch {
      return [];
    }
  }

  write(userId: string, keys: readonly string[]): void {
    if (keys.length === 0) {
      forgetToastedTiers(this.document, userId);
      return;
    }
    try {
      this.storage?.setItem(toastedTiersKey(userId), JSON.stringify(keys));
    } catch {
      return;
    }
  }
}
