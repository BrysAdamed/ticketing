export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
export const PROJECT_KEY_MAX_LENGTH = 10;
export const PROJECT_NAME_MAX_LENGTH = 100;

/// Suggests a project key from its name (layout-and-screens §3.1): initials of a multi-word name
/// ("Customer Portal" → "CP"), or the start of a single word ("Payments" → "PAYM"). Always
/// matches `PROJECT_KEY_PATTERN`, or is empty when the name has no letters.
export function suggestProjectKey(name: string): string {
  const words = name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
  const firstLetter = words.findIndex((w) => /^[A-Z]/.test(w));
  if (firstLetter < 0) return '';
  const usable = words.slice(firstLetter);

  let key = usable.length > 1 ? usable.map((w) => w[0]).join('') : usable[0].slice(0, 4);
  if (key.length < 2) key = (key + usable.join('').slice(1)).slice(0, 4);
  if (key.length < 2) key = key.padEnd(2, 'X');
  return key.slice(0, PROJECT_KEY_MAX_LENGTH);
}

/// Normalizes typed input the way the server stores it: upper-case, no spaces.
export function normalizeProjectKeyInput(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '');
}

/// A human message for an invalid key, or null when the key is valid.
export function projectKeyError(key: string): string | null {
  if (!key) return 'Enter a key.';
  if (!/^[A-Z]/.test(key)) return 'The key must start with a letter.';
  if (/[^A-Z0-9]/.test(key)) return 'Use only letters A–Z and digits.';
  if (key.length < 2) return 'Use at least 2 characters.';
  if (key.length > PROJECT_KEY_MAX_LENGTH)
    return `Use at most ${PROJECT_KEY_MAX_LENGTH} characters.`;
  return null;
}
