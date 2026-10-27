import { InjectionToken, TemplateRef } from '@angular/core';
import { Priority, Severity, TicketStatus, TicketType } from '@shared/domain/enums';

/// Domain glyph shown before an option's label (a severity renders as its tinted badge instead).
export type PickerIcon =
  | { kind: 'status'; status: TicketStatus }
  | { kind: 'type'; type: TicketType }
  | { kind: 'priority'; priority: Priority }
  | { kind: 'severity'; severity: Severity }
  | { kind: 'icon'; name: string };

export interface PickerOption<T> {
  value: T;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
  icon?: PickerIcon;
}

/// Tells pickers whether their keyboard hint (for example `S`) is a shortcut registered in the
/// current scope, so a hint is shown only where the key works. Defaults to showing every hint.
export const PICKER_SHORTCUT_AVAILABLE = new InjectionToken<(keys: string) => boolean>(
  'PICKER_SHORTCUT_AVAILABLE',
  { factory: () => () => true },
);

export interface PickerOptionContext<T> {
  $implicit: PickerOption<T>;
  selected: boolean;
}

export type PickerOptionTemplate<T> = TemplateRef<PickerOptionContext<T>>;

export function filterOptions<T>(
  options: readonly PickerOption<T>[],
  query: string,
): PickerOption<T>[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...options];
  const starts: PickerOption<T>[] = [];
  const contains: PickerOption<T>[] = [];
  for (const option of options) {
    const haystack = [option.label, ...(option.keywords ?? [])].map((s) => s.toLowerCase());
    if (haystack.some((s) => s.startsWith(q))) starts.push(option);
    else if (haystack.some((s) => s.includes(q))) contains.push(option);
  }
  return [...starts, ...contains];
}
