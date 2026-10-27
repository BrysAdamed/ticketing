const STORAGE_KEY = 'tk-diagram-heights';
const MAX_ENTRIES = 300;
const SAVE_DELAY_MS = 500;

let heights: Map<string, number> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;

/// The last rendered height (px) of a diagram, by an id the caller derives from its content (for
/// example a hash of the Mermaid source). Placeholders reserve it so a late render does not
/// shift the page. Kept in localStorage (the newest 300); free of Angular.
export function rememberedHeight(id: string): number | null {
  return load().get(id) ?? null;
}

export function rememberHeight(id: string, height: number): void {
  const rounded = Math.round(height);
  if (rounded <= 0) return;
  const map = load();
  if (map.get(id) === rounded) return;
  map.delete(id);
  map.set(id, rounded);
  while (map.size > MAX_ENTRIES) map.delete(map.keys().next().value!);
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

function load(): Map<string, number> {
  if (heights) return heights;
  heights = new Map();
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? '[]') as unknown;
    if (Array.isArray(stored))
      for (const entry of stored)
        if (Array.isArray(entry) && typeof entry[0] === 'string' && typeof entry[1] === 'number')
          heights.set(entry[0], entry[1]);
  } catch {
    return heights;
  }
  return heights;
}

function save(): void {
  saveTimer = null;
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify([...load()]));
  } catch {
    return;
  }
}
