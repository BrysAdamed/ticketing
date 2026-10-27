import { RegressionItem, RegressionSummary } from '@core/testing/testing.models';
import { REGRESSION_ITEM_STATUS_LABELS, RegressionItemStatus } from '@shared/domain/enums';

export type ItemFilter = 'mine' | 'waiting' | 'failed' | 'all';

export const ITEM_FILTERS: readonly ItemFilter[] = ['mine', 'waiting', 'failed', 'all'];

/// Group order in the execution list: what still needs doing first.
const GROUP_ORDER: readonly RegressionItemStatus[] = ['WaitingForExecution', 'Failed', 'Passed', 'Skipped'];

export interface GroupRow {
  kind: 'group';
  status: RegressionItemStatus;
  label: string;
  count: number;
}

export interface ItemRow {
  kind: 'item';
  item: RegressionItem;
}

export type SessionRow = GroupRow | ItemRow;

export function parseFilter(value: string | null | undefined): ItemFilter {
  return (ITEM_FILTERS as readonly string[]).includes(value ?? '') ? (value as ItemFilter) : 'all';
}

export function matchesFilter(item: RegressionItem, filter: ItemFilter, meId: string | null, text = ''): boolean {
  const q = text.trim().toLowerCase();
  if (q && !item.title.toLowerCase().includes(q) && !item.testCaseKey.toLowerCase().includes(q)) return false;
  switch (filter) {
    case 'mine':
      return meId !== null && item.assignee?.id === meId;
    case 'waiting':
      return item.status === 'WaitingForExecution';
    case 'failed':
      return item.status === 'Failed';
    default:
      return true;
  }
}

export function filterCounts(items: readonly RegressionItem[], meId: string | null): Record<ItemFilter, number> {
  return {
    mine: items.filter((i) => meId !== null && i.assignee?.id === meId).length,
    waiting: items.filter((i) => i.status === 'WaitingForExecution').length,
    failed: items.filter((i) => i.status === 'Failed').length,
    all: items.length,
  };
}

/// Items grouped by status (Waiting, Failed, Passed, Skipped), each group in snapshot order.
export function buildRows(items: readonly RegressionItem[]): SessionRow[] {
  const rows: SessionRow[] = [];
  for (const status of GROUP_ORDER) {
    const group = items.filter((i) => i.status === status).sort((a, b) => a.order - b.order);
    if (group.length === 0) continue;
    rows.push({ kind: 'group', status, label: REGRESSION_ITEM_STATUS_LABELS[status], count: group.length });
    for (const item of group) rows.push({ kind: 'item', item });
  }
  return rows;
}

/// The visible items in list order, for j/k navigation.
export function orderedItems(rows: readonly SessionRow[]): RegressionItem[] {
  return rows.filter((r): r is ItemRow => r.kind === 'item').map((r) => r.item);
}

/// The next waiting item after `currentKey` in snapshot order (wrapping), preferring my own and
/// unassigned items over items someone else has taken; null when nothing is waiting.
export function nextWaiting(items: readonly RegressionItem[], currentKey: string | null, meId: string | null): RegressionItem | null {
  const sorted = [...items].sort((a, b) => a.order - b.order);
  const start = currentKey ? sorted.findIndex((i) => i.testCaseKey === currentKey) : -1;
  const rotated = [...sorted.slice(start + 1), ...sorted.slice(0, start + 1)];
  const waiting = rotated.filter((i) => i.status === 'WaitingForExecution' && i.testCaseKey !== currentKey);
  return waiting.find((i) => !i.assignee || i.assignee.id === meId) ?? waiting[0] ?? null;
}

/// Progress segments in the design-system order: passed, failed, skipped, waiting (percent of total).
export function progressSegments(summary: RegressionSummary): { key: 'passed' | 'failed' | 'skipped' | 'waiting'; count: number; percent: number }[] {
  const total = summary.total || 1;
  return (
    [
      ['passed', summary.passed],
      ['failed', summary.failed],
      ['skipped', summary.skipped],
      ['waiting', summary.waiting],
    ] as const
  ).map(([key, count]) => ({ key, count, percent: (100 * count) / total }));
}

export function passRateLabel(summary: RegressionSummary): string {
  return summary.passRate === null ? '–' : `${Math.round(summary.passRate * 100)}%`;
}

/// Applies an item change to the session's items.
export function replaceItem(items: readonly RegressionItem[], item: RegressionItem): RegressionItem[] {
  return items.map((i) => (i.id === item.id ? item : i));
}
