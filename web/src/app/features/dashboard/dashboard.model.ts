import { DocSummary } from '@core/docs/doc.models';
import {
  Priority,
  RegressionSessionStatus,
  Severity,
  StatusCategory,
  TestCaseStatus,
  TicketStatus,
  TicketType,
} from '@shared/domain/enums';

/// `GET /api/v1/projects/{key}/dashboard?version=` (spec §7). Ticket widgets honour `version`.
export interface ProjectDashboard {
  projectKey: string;
  version: string | null;
  generatedAt: string;
  totals: DashboardTotals;
  byStatus: { status: TicketStatus; category: StatusCategory; count: number }[];
  byType: { type: TicketType; count: number }[];
  byPriority: { priority: Priority; count: number }[];
  openBugsBySeverity: { severity: Severity | null; count: number }[];
  createdVsResolved: WeekCount[];
  openByAssignee: {
    top: { user: DashboardUser; count: number }[];
    unassigned: number;
    others: number;
  };
  stale: { count: number; olderThanDays: number; updatedBefore: string; oldest: DashboardTicket[] };
  epicProgress: { openEpics: number; epics: EpicProgress[] };
  testCases: {
    total: number;
    byStatus: { status: TestCaseStatus; count: number }[];
    automationRatio: number | null;
  };
  regressions: { latest: RegressionSessionSummary | null; recentPassRates: RegressionPassRate[] };
  regressionBugs: { count: number; items: DashboardTicket[] };
  /// Widget 13: pages and diagrams (no folders), the 5 latest by `updatedAt`.
  recentDocs: { total: number; items: DocSummary[] };
}

export interface DashboardTotals {
  openTickets: number;
  doneTickets: number;
  openStoryPoints: number;
  unassignedOpenTickets: number;
}

export interface WeekCount {
  weekStart: string;
  isoWeek: string;
  created: number;
  resolved: number;
}

export interface DashboardUser {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
}

export interface DashboardTicket {
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
  priority: Priority;
  severity: Severity | null;
  assignee: DashboardUser | null;
  updatedAt: string;
}

export interface Progress {
  done: number;
  total: number;
}

export interface EpicProgress {
  key: string;
  title: string;
  status: TicketStatus;
  priority: Priority;
  children: Progress;
  points: Progress;
}

export interface RegressionSessionSummary {
  key: string;
  name: string;
  version: string | null;
  status: RegressionSessionStatus;
  startedAt: string;
  completedAt: string | null;
  total: number;
  passed: number;
  passedManual: number;
  passedAutomatic: number;
  failed: number;
  skipped: number;
  waiting: number;
  passRate: number | null;
  bugsCreated: number;
}

export interface RegressionPassRate {
  key: string;
  name: string;
  version: string | null;
  completedAt: string;
  passed: number;
  failed: number;
  passRate: number | null;
}
