import {
  Priority,
  PRIORITY_LABELS,
  Severity,
  SEVERITY_LABELS,
  STATUS_CATEGORIES,
  STATUS_CATEGORY_LABELS,
  StatusCategory,
  TICKET_STATUS_LABELS,
  TICKET_TYPE_LABELS,
} from '@shared/domain/enums';
import { DashboardLinks } from './dashboard-links';
import { ProjectDashboard } from './dashboard.model';
import { BarItem } from './widgets/bar-list.component';

/// Pure mappers from the dashboard response to what the widgets draw. Colours are design tokens
/// (design-system §8–9): domain values keep their domain colour everywhere, so a status looks the
/// same here as on the board.

const PRIORITY_COLORS: Record<Priority, string> = {
  Highest: 'var(--tk-priority-highest)',
  High: 'var(--tk-priority-high)',
  Medium: 'var(--tk-priority-bar)',
  Low: 'var(--tk-priority-bar)',
  Lowest: 'var(--tk-priority-bar-off)',
};

const SEVERITY_COLORS: Record<Severity, string> = {
  Blocker: 'var(--tk-severity-critical)',
  Critical: 'var(--tk-severity-critical)',
  Major: 'var(--tk-severity-major)',
  Minor: 'var(--tk-severity-minor)',
  Trivial: 'var(--tk-severity-trivial)',
};

const ASSIGNEE_COLOR = 'var(--tk-palette-0)';
const OTHER_COLOR = 'var(--tk-text-subtle)';

export function statusItems(data: ProjectDashboard, links: DashboardLinks): BarItem[] {
  return data.byStatus.map((s) => ({
    id: s.status,
    label: TICKET_STATUS_LABELS[s.status],
    count: s.count,
    color: `var(--tk-status-${s.status.toLowerCase()})`,
    lead: { kind: 'status', status: s.status },
    link: links.status(s.status),
  }));
}

export interface CategorySegment {
  category: StatusCategory;
  label: string;
  count: number;
  share: number;
  color: string;
}

/// Part-to-whole of all tickets by status category, for the 100% stacked bar.
export function categorySegments(data: ProjectDashboard): CategorySegment[] {
  const total = data.byStatus.reduce((sum, s) => sum + s.count, 0);
  return STATUS_CATEGORIES.map((category) => {
    const count = data.byStatus
      .filter((s) => s.category === category)
      .reduce((sum, s) => sum + s.count, 0);
    return {
      category,
      label: STATUS_CATEGORY_LABELS[category],
      count,
      share: total === 0 ? 0 : (count / total) * 100,
      color: `var(--tk-category-${category.toLowerCase()})`,
    };
  });
}

export function typeItems(data: ProjectDashboard, links: DashboardLinks): BarItem[] {
  return data.byType.map((t) => ({
    id: t.type,
    label: TICKET_TYPE_LABELS[t.type],
    count: t.count,
    color: `var(--tk-type-${t.type.toLowerCase()})`,
    lead: { kind: 'type', type: t.type },
    link: links.openOfType(t.type),
  }));
}

export function priorityItems(data: ProjectDashboard, links: DashboardLinks): BarItem[] {
  return data.byPriority.map((p) => ({
    id: p.priority,
    label: PRIORITY_LABELS[p.priority],
    count: p.count,
    color: PRIORITY_COLORS[p.priority],
    lead: { kind: 'priority', priority: p.priority },
    link: links.openWithPriority(p.priority),
  }));
}

export function severityItems(data: ProjectDashboard, links: DashboardLinks): BarItem[] {
  return data.openBugsBySeverity.map((s) => ({
    id: s.severity ?? 'none',
    label: s.severity ? SEVERITY_LABELS[s.severity] : 'No severity',
    count: s.count,
    color: s.severity ? SEVERITY_COLORS[s.severity] : OTHER_COLOR,
    lead: { kind: 'severity', severity: s.severity },
    link: links.openBugsWithSeverity(s.severity),
    muted: s.severity === null,
  }));
}

export function assigneeItems(data: ProjectDashboard, links: DashboardLinks): BarItem[] {
  const { top, unassigned, others } = data.openByAssignee;
  const items: BarItem[] = top.map((a) => ({
    id: a.user.id,
    label: a.user.isActive ? a.user.displayName : `${a.user.displayName} (deactivated)`,
    count: a.count,
    color: ASSIGNEE_COLOR,
    lead: { kind: 'avatar', userId: a.user.id, name: a.user.displayName },
    link: links.openAssignedTo(a.user.id),
  }));
  items.push({
    id: 'unassigned',
    label: 'Unassigned',
    count: unassigned,
    color: OTHER_COLOR,
    lead: { kind: 'avatar', userId: null, name: null },
    link: links.unassignedOpen(),
    muted: true,
  });
  if (others > 0) {
    items.push({
      id: 'others',
      label: 'Others',
      count: others,
      color: OTHER_COLOR,
      lead: { kind: 'icon', icon: 'tablerUsers' },
      link: links.openAssignedToOthers(top.map((a) => a.user.id)),
      muted: true,
    });
  }
  return items;
}

export function sum(items: readonly { count: number }[]): number {
  return items.reduce((total, item) => total + item.count, 0);
}

/// `part / whole` as a whole percentage, or null when there is nothing to divide.
export function percent(part: number, whole: number): number | null {
  return whole === 0 ? null : Math.round((part / whole) * 100);
}
