import { TestCase, TestCaseCounts, TestCaseSummary } from '@core/testing/testing.models';
import { TEST_CASE_STATUSES, TestCaseStatus } from '@shared/domain/enums';

export type StatusFilter = TestCaseStatus | 'All';

/// The list filters; all of them live in the URL (I-21) as `status`, `q`, `ticket` and `archived`.
export interface TestCaseFilters {
  status: StatusFilter;
  text: string;
  ticket: string | null;
  archived: boolean;
}

export const EMPTY_FILTERS: TestCaseFilters = {
  status: 'All',
  text: '',
  ticket: null,
  archived: false,
};

export function filtersFromQuery(query: {
  status?: string | null;
  q?: string | null;
  ticket?: string | null;
  archived?: string | null;
}): TestCaseFilters {
  const status = (TEST_CASE_STATUSES as readonly string[]).includes(query.status ?? '')
    ? (query.status as TestCaseStatus)
    : 'All';
  return {
    status,
    text: query.q ?? '',
    ticket: query.ticket ? query.ticket.toUpperCase() : null,
    archived: query.archived === 'true' || query.archived === '1',
  };
}

export function filtersToQuery(filters: TestCaseFilters): Record<string, string | null> {
  return {
    status: filters.status === 'All' ? null : filters.status,
    q: filters.text.trim() || null,
    ticket: filters.ticket,
    archived: filters.archived ? 'true' : null,
  };
}

export function isFiltered(filters: TestCaseFilters): boolean {
  return (
    filters.status !== 'All' ||
    filters.text.trim() !== '' ||
    filters.ticket !== null ||
    filters.archived
  );
}

export function summaryOf(testCase: TestCase): TestCaseSummary {
  const lastRun = testCase.recentRuns.find((r) => r.status !== 'WaitingForExecution') ?? null;
  return {
    id: testCase.id,
    key: testCase.key,
    number: testCase.number,
    title: testCase.title,
    status: testCase.status,
    stepCount: testCase.steps.length,
    ticket: testCase.ticket,
    archived: testCase.archivedAt !== null,
    updatedAt: testCase.updatedAt,
    lastRun: lastRun
      ? { sessionKey: lastRun.sessionKey, status: lastRun.status, executedAt: lastRun.executedAt }
      : null,
  };
}

/// Whether a row belongs in the list under the current filters (mirrors the server's filters).
export function matches(row: TestCaseSummary, filters: TestCaseFilters): boolean {
  if (row.archived && !filters.archived) return false;
  if (filters.status !== 'All' && row.status !== filters.status) return false;
  if (filters.ticket && row.ticket?.key !== filters.ticket) return false;
  const text = filters.text.trim().toLowerCase();
  if (
    text &&
    !row.title.toLowerCase().includes(text) &&
    !row.key.toLowerCase().includes(text) &&
    String(row.number) !== text
  )
    return false;
  return true;
}

/// Applies a saved test case to the loaded rows (in number order) without a refetch.
export function upsertRow(
  rows: readonly TestCaseSummary[],
  row: TestCaseSummary,
  filters: TestCaseFilters,
): TestCaseSummary[] {
  const without = rows.filter((r) => r.id !== row.id);
  if (!matches(row, filters)) return without;
  const index = without.findIndex((r) => r.number > row.number);
  if (index === -1) return [...without, row];
  return [...without.slice(0, index), row, ...without.slice(index)];
}

/// Moves one test case between the count buckets after a create, edit, archive or delete.
export function adjustCounts(
  counts: TestCaseCounts,
  before: TestCaseSummary | null,
  after: TestCaseSummary | null,
): TestCaseCounts {
  const next = { ...counts };
  const bucket = (row: TestCaseSummary): keyof TestCaseCounts =>
    row.archived ? 'archived' : (row.status.toLowerCase() as 'new' | 'manual' | 'automatic');
  if (before) next[bucket(before)] = Math.max(0, next[bucket(before)] - 1);
  if (after) next[bucket(after)] += 1;
  next.active = next.new + next.manual + next.automatic;
  return next;
}
