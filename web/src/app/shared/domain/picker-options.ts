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
