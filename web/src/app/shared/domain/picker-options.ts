import { PickerOption } from '@shared/ui/inline-picker/picker-option';
import {
  PRIORITIES,
  Priority,
  PRIORITY_LABELS,
  SEVERITIES,
  Severity,
  SEVERITY_LABELS,
  TEST_CASE_STATUS_LABELS,
  TEST_CASE_STATUSES,
  TestCaseStatus,
  TICKET_STATUS_LABELS,
  TICKET_STATUSES,
  TICKET_TYPE_LABELS,
  TICKET_TYPES,
  TicketStatus,
  TicketType,
} from './enums';

function optionsOf<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
): PickerOption<T>[] {
  return values.map((value) => ({ value, label: labels[value], keywords: [value] }));
}

export const TICKET_STATUS_OPTIONS: readonly PickerOption<TicketStatus>[] = optionsOf(
  TICKET_STATUSES,
  TICKET_STATUS_LABELS,
);
export const PRIORITY_OPTIONS: readonly PickerOption<Priority>[] = optionsOf(
  PRIORITIES,
  PRIORITY_LABELS,
);
export const SEVERITY_OPTIONS: readonly PickerOption<Severity>[] = optionsOf(
  SEVERITIES,
  SEVERITY_LABELS,
);
export const TICKET_TYPE_OPTIONS: readonly PickerOption<TicketType>[] = optionsOf(
  TICKET_TYPES,
  TICKET_TYPE_LABELS,
);
export const TEST_CASE_STATUS_OPTIONS: readonly PickerOption<TestCaseStatus>[] = optionsOf(
  TEST_CASE_STATUSES,
  TEST_CASE_STATUS_LABELS,
);

/// Story points offered by pickers (D-27: Fibonacci suggestions, any 0..100 value is valid).
export const STORY_POINT_VALUES = [0, 1, 2, 3, 5, 8, 13, 21] as const;

export const STORY_POINT_OPTIONS: readonly PickerOption<number | null>[] = [
  { value: null, label: 'No estimate', keywords: ['none', 'clear'] },
  ...STORY_POINT_VALUES.map((value) => ({ value, label: String(value) })),
];

export interface PickerUser {
  id: string;
  displayName: string;
  email?: string;
}

/// Assignee options: "Unassigned" first (value null), then the users by name.
export function userOptions(users: readonly PickerUser[], includeUnassigned = true): PickerOption<string | null>[] {
  const options: PickerOption<string | null>[] = users.map((user) => ({
    value: user.id,
    label: user.displayName,
    keywords: user.email ? [user.email] : [],
  }));
  return includeUnassigned ? [{ value: null, label: 'Unassigned', keywords: ['none'] }, ...options] : options;
}
