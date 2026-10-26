import { TemplateRef } from '@angular/core';

export interface PickerOption<T> {
  value: T;
  label: string;
  keywords?: readonly string[];
  disabled?: boolean;
}

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
