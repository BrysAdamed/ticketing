export const PALETTE_SIZE = 8;

export function fnv1a(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function paletteIndex(text: string): number {
  return fnv1a(text.toLowerCase()) % PALETTE_SIZE;
}
