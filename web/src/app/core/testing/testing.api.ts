import { inject, Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { ApiClient } from '../api/api-client';
import { Page } from '../api/page';
import { RegressionItemStatus, RegressionSessionStatus } from '@shared/domain/enums';
import {
  BugOverrides,
  NewTestCase,
  RegressionBugDraft,
  RegressionItemChange,
  RegressionSession,
  RegressionSessionSummary,
  TestCase,
  TestCaseList,
  TestCasePatch,
  TestCaseQuery,
  TestCaseSummary,
} from './testing.models';

const tc = (key: string) => `/test-cases/${encodeURIComponent(key)}`;
const session = (key: string) => `/regression-sessions/${encodeURIComponent(key)}`;
const item = (sessionKey: string, testCaseKey: string) =>
  `${session(sessionKey)}/items/${encodeURIComponent(testCaseKey)}`;

/// Typed client for test cases (spec 6.10). Lives in core because test cases, the ticket view section,
/// regressions, search and My work all use it (D-50).
@Injectable({ providedIn: 'root' })
export class TestCasesApi {
  private readonly api = inject(ApiClient);

  list(projectKey: string, query: TestCaseQuery = {}): Observable<TestCaseList> {
    return this.api.get<TestCaseList>(`/projects/${projectKey}/test-cases`, { ...query });
  }

  forTicket(ticketKey: string): Observable<TestCaseSummary[]> {
    return this.api.get<TestCaseSummary[]>(`/tickets/${encodeURIComponent(ticketKey)}/test-cases`);
  }

  get(key: string): Observable<TestCase> {
    return this.api.get<TestCase>(tc(key));
  }

  create(projectKey: string, testCase: NewTestCase, idempotencyKey?: string): Observable<TestCase> {
    return this.api.post<TestCase>(`/projects/${projectKey}/test-cases`, testCase, {
      idempotencyKey,
    });
  }

  update(key: string, patch: TestCasePatch, rowVersion?: number): Observable<TestCase> {
    return this.api.patch<TestCase>(tc(key), patch, { rowVersion });
  }

  delete(key: string): Observable<void> {
    return this.api.delete(tc(key));
  }
}

/// Typed client for regression sessions (spec 6.11).
@Injectable({ providedIn: 'root' })
export class RegressionsApi {
  private readonly api = inject(ApiClient);

  list(
    projectKey: string,
    query: {
      status?: readonly RegressionSessionStatus[];
      limit?: number;
      cursor?: string | null;
    } = {},
  ): Observable<Page<RegressionSessionSummary>> {
    return this.api.get<Page<RegressionSessionSummary>>(
      `/projects/${projectKey}/regression-sessions`,
      { ...query },
    );
  }

  start(
    projectKey: string,
    body: { name?: string | null; version?: string | null },
    idempotencyKey?: string,
  ): Observable<RegressionSession> {
    return this.api.post<RegressionSession>(`/projects/${projectKey}/regression-sessions`, body, {
      idempotencyKey,
    });
  }

  get(
    sessionKey: string,
    query: { itemStatus?: readonly RegressionItemStatus[]; assignee?: string | null } = {},
  ): Observable<RegressionSession> {
    return this.api.get<RegressionSession>(session(sessionKey), { ...query });
  }

  take(sessionKey: string, testCaseKey: string): Observable<RegressionItemChange> {
    return this.api.post<RegressionItemChange>(`${item(sessionKey, testCaseKey)}/take`);
  }

  assign(
    sessionKey: string,
    testCaseKey: string,
    assignee: string | null,
  ): Observable<RegressionItemChange> {
    return this.api.post<RegressionItemChange>(`${item(sessionKey, testCaseKey)}/assign`, {
      assignee,
    });
  }

  record(
    sessionKey: string,
    testCaseKey: string,
    body: {
      status: RegressionItemStatus;
      note?: string | null;
      createBug?: boolean;
      bug?: BugOverrides;
    },
  ): Observable<RegressionItemChange> {
    return this.api.post<RegressionItemChange>(`${item(sessionKey, testCaseKey)}/result`, body);
  }

  bugDraft(sessionKey: string, testCaseKey: string): Observable<RegressionBugDraft> {
    return this.api.get<RegressionBugDraft>(`${item(sessionKey, testCaseKey)}/bug-draft`);
  }

  createBug(
    sessionKey: string,
    testCaseKey: string,
    overrides: BugOverrides,
  ): Observable<RegressionItemChange> {
    return this.api.post<RegressionItemChange>(`${item(sessionKey, testCaseKey)}/bug`, overrides);
  }

  complete(sessionKey: string, skipRemaining: boolean): Observable<RegressionSessionSummary> {
    return this.api.post<RegressionSessionSummary>(`${session(sessionKey)}/complete`, {
      skipRemaining,
    });
  }

  cancel(sessionKey: string): Observable<RegressionSessionSummary> {
    return this.api.post<RegressionSessionSummary>(`${session(sessionKey)}/cancel`);
  }
}
