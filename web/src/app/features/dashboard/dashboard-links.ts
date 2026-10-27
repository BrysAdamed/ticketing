import { Params } from '@angular/router';
import { Priority, Severity, TestCaseStatus, TicketStatus, TicketType } from '@shared/domain/enums';
import { WeekCount } from './dashboard.model';

/// A router link: `[routerLink]="link.path" [queryParams]="link.query"`.
export interface DashboardLink {
  path: string;
  query: Params;
}

const OPEN = 'ToDo,InProgress';

/// Builds the search URLs behind every dashboard count, in the format of
/// docs/architecture/search-url-format.md. Every ticket link carries the project and, when the
/// dashboard is filtered, the version, so the search reproduces the exact number shown.
export class DashboardLinks {
  constructor(
    private readonly projectKey: string,
    private readonly version: string | null,
  ) {}

  open(): DashboardLink {
    return this.search({ category: OPEN });
  }

  done(): DashboardLink {
    return this.search({ category: 'Done' });
  }

  unassignedOpen(): DashboardLink {
    return this.search({ category: OPEN, assignee: 'unassigned' });
  }

  status(status: TicketStatus): DashboardLink {
    return this.search({ status });
  }

  openOfType(type: TicketType): DashboardLink {
    return this.search({ type, category: OPEN });
  }

  openWithPriority(priority: Priority): DashboardLink {
    return this.search({ priority, category: OPEN });
  }

  openBugsWithSeverity(severity: Severity | null): DashboardLink {
    return this.search({ type: 'Bug', severity: severity ?? 'none', category: OPEN });
  }

  createdIn(week: WeekCount): DashboardLink {
    return this.search({ createdFrom: week.weekStart, createdTo: weekEnd(week.weekStart) });
  }

  resolvedIn(week: WeekCount): DashboardLink {
    return this.search({ resolvedFrom: week.weekStart, resolvedTo: weekEnd(week.weekStart) });
  }

  openAssignedTo(userId: string): DashboardLink {
    return this.search({ assignee: userId, category: OPEN });
  }

  /// Open tickets assigned to someone outside the top list (the "Others" bucket).
  openAssignedToOthers(topUserIds: readonly string[]): DashboardLink {
    return this.search({ assigneeNot: [...topUserIds, 'unassigned'].join(','), category: OPEN });
  }

  stale(updatedBefore: string): DashboardLink {
    return this.search({ category: OPEN, updatedTo: updatedBefore, sort: 'updated', order: 'asc' });
  }

  children(epicKey: string, doneOnly = false): DashboardLink {
    return this.search({ parent: epicKey, status: doneOnly ? 'Done' : null, sort: 'rank' });
  }

  openRegressionBugs(): DashboardLink {
    return this.search({ fromRegression: 'true', category: OPEN });
  }

  testCases(status?: TestCaseStatus): DashboardLink {
    return {
      path: `/projects/${this.projectKey}/test-cases`,
      query: status ? { status } : {},
    };
  }

  regressionSession(sessionKey: string): DashboardLink {
    return { path: `/projects/${this.projectKey}/regressions/${sessionKey}`, query: {} };
  }

  private search(filters: Record<string, string | null>): DashboardLink {
    const query: Params = { project: this.projectKey };
    for (const [name, value] of Object.entries(filters)) if (value !== null) query[name] = value;
    if (this.version !== null) query['version'] = this.version;
    return { path: '/search', query };
  }
}

/// Sunday of the ISO week starting on `weekStart` (yyyy-MM-dd, UTC).
export function weekEnd(weekStart: string): string {
  const date = new Date(`${weekStart}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 6);
  return date.toISOString().slice(0, 10);
}
