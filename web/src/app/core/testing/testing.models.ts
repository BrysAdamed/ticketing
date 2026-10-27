import {
  ExecutionMode,
  Priority,
  RegressionItemStatus,
  RegressionSessionStatus,
  Severity,
  TestCaseStatus,
  TicketStatus,
  TicketType,
} from '@shared/domain/enums';
import { TicketSummary, UserRef } from '../tickets/ticket.models';

/// Wire types of the test cases and regressions slice (`/api/v1/test-cases`, `/api/v1/regression-sessions`).

export interface LinkedTicket {
  id: string;
  key: string;
  title: string;
  type: TicketType;
  status: TicketStatus;
}

export interface TestCaseLastRun {
  sessionKey: string;
  status: RegressionItemStatus;
  executedAt: string | null;
}

export interface TestCaseSummary {
  id: string;
  key: string;
  number: number;
  title: string;
  status: TestCaseStatus;
  stepCount: number;
  ticket: LinkedTicket | null;
  archived: boolean;
  updatedAt: string;
  lastRun: TestCaseLastRun | null;
}

export interface TestCaseCounts {
  new: number;
  manual: number;
  automatic: number;
  archived: number;
  active: number;
}

export interface TestCaseList {
  items: TestCaseSummary[];
  nextCursor: string | null;
  counts: TestCaseCounts;
}

export interface TestCaseRun {
  sessionId: string;
  sessionKey: string;
  sessionName: string;
  version: string | null;
  sessionStatus: RegressionSessionStatus;
  status: RegressionItemStatus;
  autoPassed: boolean;
  executedAt: string | null;
  executedBy: UserRef | null;
  bugKey: string | null;
}

export interface TestCase {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  number: number;
  title: string;
  preconditions: string | null;
  steps: string[];
  expectedResult: string | null;
  status: TestCaseStatus;
  automationReference: string | null;
  ticket: LinkedTicket | null;
  archivedAt: string | null;
  archivedBy: UserRef | null;
  createdAt: string;
  createdBy: UserRef;
  updatedAt: string;
  sessionCount: number;
  recentRuns: TestCaseRun[];
  permissions: { canEdit: boolean; canDelete: boolean };
  url: string;
  rowVersion: number;
}

export interface NewTestCase {
  title: string;
  preconditions?: string | null;
  steps?: string[];
  expectedResult?: string | null;
  status?: TestCaseStatus;
  automationReference?: string | null;
  ticketKey?: string | null;
}

/// PATCH body: omitted fields stay, `null` clears, `steps` replaces the list, `archived` archives or unarchives.
export interface TestCasePatch {
  title?: string;
  preconditions?: string | null;
  steps?: string[];
  expectedResult?: string | null;
  status?: TestCaseStatus;
  automationReference?: string | null;
  ticketKey?: string | null;
  archived?: boolean;
}

export interface TestCaseQuery {
  status?: readonly TestCaseStatus[];
  ticket?: string | null;
  text?: string | null;
  includeArchived?: boolean;
  limit?: number;
  cursor?: string | null;
}

export interface RegressionSummary {
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

export interface RegressionSessionSummary {
  id: string;
  key: string;
  number: number;
  name: string;
  version: string | null;
  status: RegressionSessionStatus;
  startedAt: string;
  startedBy: UserRef;
  completedAt: string | null;
  cancelledAt: string | null;
  summary: RegressionSummary;
  url: string;
}

export interface RegressionBugRef {
  id: string;
  key: string;
  title: string;
  status: TicketStatus;
  deleted: boolean;
  url: string;
}

export interface RegressionItem {
  id: string;
  testCaseId: string;
  testCaseKey: string;
  order: number;
  title: string;
  preconditions: string | null;
  steps: string[];
  expectedResult: string | null;
  automationReference: string | null;
  executionMode: ExecutionMode;
  status: RegressionItemStatus;
  autoPassed: boolean;
  assignee: UserRef | null;
  resultNote: string | null;
  executedAt: string | null;
  executedBy: UserRef | null;
  bug: RegressionBugRef | null;
  url: string;
  rowVersion: number;
}

export interface RegressionPermissions {
  canExecute: boolean;
  canAssign: boolean;
  canComplete: boolean;
  canCancel: boolean;
}

export interface RegressionSession {
  id: string;
  key: string;
  projectId: string;
  projectKey: string;
  number: number;
  name: string;
  version: string | null;
  status: RegressionSessionStatus;
  startedAt: string;
  startedBy: UserRef;
  completedAt: string | null;
  completedBy: UserRef | null;
  cancelledAt: string | null;
  cancelledBy: UserRef | null;
  summary: RegressionSummary;
  items: RegressionItem[];
  permissions: RegressionPermissions;
  url: string;
  rowVersion: number;
}

export interface RegressionItemChange {
  item: RegressionItem;
  summary: RegressionSummary;
  createdBug: TicketSummary | null;
}

export interface BugOverrides {
  title?: string;
  description?: string | null;
  severity?: Severity | null;
  priority?: Priority;
  version?: string | null;
  labels?: string[];
  assignee?: string | null;
}

export interface RegressionBugDraft {
  projectKey: string;
  title: string;
  description: string;
  type: TicketType;
  severity: Severity;
  priority: Priority;
  version: string | null;
  labels: string[];
  relatedTicket: LinkedTicket | null;
}
