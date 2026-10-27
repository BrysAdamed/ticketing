import { DOCUMENT } from '@angular/common';
import { DestroyRef, inject, Injectable, signal } from '@angular/core';

/// A keyboard shortcut. `keys` uses lower-case names joined by `+` for chords and a space for
/// sequences: `mod+k` (Ctrl on Windows/Linux, ⌘ on macOS), `?`, `g b`, `shift+enter`, `escape`.
export interface Shortcut {
  keys: string;
  description: string;
  section?: string;
  handler: (event: KeyboardEvent) => void;
  /// Also fire while focus is in an input, textarea, select or contenteditable.
  allowInInputs?: boolean;
  /// Listed in the `?` help sheet (default true).
  showInHelp?: boolean;
}

export interface RegisteredShortcut extends Shortcut {
  readonly id: number;
}

const SEQUENCE_TIMEOUT_MS = 1000;

/// Global keyboard shortcuts on `document`. Later registrations of the same keys take precedence
/// over earlier ones until they are removed, so a page can temporarily override a global key
/// (for example `/`). Single-key shortcuts are ignored while typing in form fields, and every
/// shortcut is ignored while a modal overlay (dialog, menu, picker) is open.
@Injectable({ providedIn: 'root' })
export class ShortcutService {
  private readonly document = inject(DOCUMENT);
  private readonly isMac = /Mac|iPhone|iPad/.test(
    this.document.defaultView?.navigator.platform ?? '',
  );
  private readonly registry = signal<readonly RegisteredShortcut[]>([]);
  private nextId = 1;
  private pendingPrefix: string | null = null;
  private pendingTimer: ReturnType<typeof setTimeout> | null = null;

  readonly shortcuts = this.registry.asReadonly();

  constructor() {
    const listener = (event: KeyboardEvent) => this.onKeydown(event);
    this.document.addEventListener('keydown', listener);
    inject(DestroyRef).onDestroy(() => this.document.removeEventListener('keydown', listener));
  }

  /// Registers a shortcut and returns a function that removes it.
  register(shortcut: Shortcut): () => void {
    const entry: RegisteredShortcut = {
      ...shortcut,
      keys: normalizeKeys(shortcut.keys),
      id: this.nextId++,
    };
    this.registry.update((list) => [...list, entry]);
    return () => this.registry.update((list) => list.filter((s) => s.id !== entry.id));
  }

  /// Registers shortcuts for the lifetime of the calling component or service.
  registerScoped(shortcuts: Shortcut[], destroyRef: DestroyRef = inject(DestroyRef)): void {
    const removers = shortcuts.map((s) => this.register(s));
    destroyRef.onDestroy(() => removers.forEach((remove) => remove()));
  }

  /// Whether a shortcut with these keys is registered right now (reactive).
  isRegistered(keys: string): boolean {
    const normalized = normalizeKeys(keys);
    return this.registry().some((s) => s.keys === normalized);
  }

  /// Display form of a key combo, e.g. `mod+k` → `Ctrl K` or `⌘K`.
  format(keys: string): string[] {
    return normalizeKeys(keys)
      .split(' ')
      .map((step) =>
        step
          .split('+')
          .map((part) => this.label(part))
          .join(this.isMac ? '' : ' '),
      );
  }

  private label(part: string): string {
    const mac: Record<string, string> = { mod: '⌘', shift: '⇧', alt: '⌥', enter: '↵' };
    const other: Record<string, string> = {
      mod: 'Ctrl',
      shift: 'Shift',
      alt: 'Alt',
      enter: 'Enter',
    };
    const common: Record<string, string> = {
      escape: 'Esc',
      arrowup: '↑',
      arrowdown: '↓',
      arrowleft: '←',
      arrowright: '→',
      backspace: '⌫',
      delete: 'Del',
      space: 'Space',
    };
    return (
      (this.isMac ? mac : other)[part] ??
      common[part] ??
      (part.length === 1 ? part.toUpperCase() : part)
    );
  }

  private onKeydown(event: KeyboardEvent): void {
    if (event.defaultPrevented || event.isComposing || event.repeat) return;
    if (this.isOverlayOpen()) {
      this.clearPending();
      return;
    }
    const combo = comboOf(event, this.isMac);
    if (!combo) return;
    const editable = isEditableTarget(event.target);
    const candidates = [...this.registry()].reverse();

    if (this.pendingPrefix) {
      const sequence = `${this.pendingPrefix} ${combo}`;
      this.clearPending();
      const match = candidates.find((s) => s.keys === sequence);
      if (match && (!editable || match.allowInInputs)) {
        event.preventDefault();
        match.handler(event);
        return;
      }
    }

    const combos = [physicalComboOf(event, this.isMac), combo].filter((c) => c !== null);
    const match = combos
      .map((c) => candidates.find((s) => s.keys === c && (!editable || s.allowInInputs)))
      .find((s) => s !== undefined);
    if (match) {
      event.preventDefault();
      match.handler(event);
      return;
    }

    if (!editable && candidates.some((s) => s.keys.startsWith(`${combo} `))) {
      this.pendingPrefix = combo;
      this.pendingTimer = setTimeout(() => this.clearPending(), SEQUENCE_TIMEOUT_MS);
    }
  }

  /// A dialog, menu, picker or any other overlay with a backdrop owns the keyboard while it is open.
  /// The CDK adds `-showing` a frame after attaching and turns off pointer events when detaching, so
  /// a backdrop that still takes pointer events is the open state from the first frame to the last.
  private isOverlayOpen(): boolean {
    return Array.from(this.document.querySelectorAll<HTMLElement>('.cdk-overlay-backdrop')).some(
      (backdrop) => backdrop.style.pointerEvents !== 'none',
    );
  }

  private clearPending(): void {
    this.pendingPrefix = null;
    if (this.pendingTimer) clearTimeout(this.pendingTimer);
    this.pendingTimer = null;
  }
}

const MODIFIER_KEYS = new Set(['control', 'meta', 'shift', 'alt']);

export function comboOf(event: KeyboardEvent, isMac: boolean): string | null {
  const key = keyName(event.key);
  if (!key || MODIFIER_KEYS.has(key)) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  const isSymbol = key.length === 1 && !/[a-z0-9]/.test(key);
  if (event.shiftKey && !isSymbol) parts.push('shift');
  parts.push(key);
  return parts.join('+');
}

const PHYSICAL_SYMBOLS: Readonly<Record<string, string>> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

/// `Shift` with a symbol key, named by the symbol on the physical key: `Ctrl Shift .` is
/// `mod+shift+.` although the browser reports `>`. It is tried before `comboOf`.
export function physicalComboOf(event: KeyboardEvent, isMac: boolean): string | null {
  const symbol = event.shiftKey ? PHYSICAL_SYMBOLS[event.code] : undefined;
  if (!symbol) return null;
  const parts: string[] = [];
  if (isMac ? event.metaKey : event.ctrlKey) parts.push('mod');
  if (event.altKey) parts.push('alt');
  parts.push('shift', symbol);
  return parts.join('+');
}

function keyName(key: string | undefined): string | null {
  if (!key) return null;
  if (key === ' ') return 'space';
  if (key === 'Esc') return 'escape';
  return key.toLowerCase();
}

export function normalizeKeys(keys: string): string {
  return keys
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((step) => {
      const parts = step.split('+').filter(Boolean);
      const key = parts.pop() ?? '';
      const order = ['mod', 'alt', 'shift'];
      const mods = order.filter((m) => parts.includes(m));
      return [...mods, key === 'esc' ? 'escape' : key].join('+');
    })
    .join(' ');
}

/// Marks an element whose keyboard belongs to an embedded editor (the Canvas editor's single-key
/// tools): inside it, and on the page body while it is shown (the editor listens on the document
/// and leaves focus there), only `allowInInputs` shortcuts fire, as in a text field.
export const OWN_KEYS_ATTR = 'data-own-keys';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable || target.closest(`[${OWN_KEYS_ATTR}]`)) return true;
  if (
    target === target.ownerDocument.body &&
    target.ownerDocument.querySelector(`[${OWN_KEYS_ATTR}]`)
  )
    return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const type = (target as HTMLInputElement).type;
  return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
}
