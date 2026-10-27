import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Observable, of, Subject, throwError } from 'rxjs';
import { AuthService } from '@core/auth/auth.service';
import { ToastService } from '@core/notify/toast.service';
import { RegressionsApi } from '@core/testing/testing.api';
import {
  BugOverrides,
  RegressionItem,
  RegressionItemChange,
  RegressionSession,
  RegressionSummary,
} from '@core/testing/testing.models';
import { CreateTicketPrefill, TicketCreator } from '@core/tickets/create-ticket';
import { TicketSummary } from '@core/tickets/ticket.models';
import { RegressionSessionStore } from './regression-session.store';

const me = { id: 'me', email: 'me@x', displayName: 'Me', isActive: true };
const summary: RegressionSummary = {
  total: 2,
  passed: 0,
  passedManual: 0,
  passedAutomatic: 0,
  failed: 0,
  skipped: 0,
  waiting: 2,
  passRate: null,
  bugsCreated: 0,
};

function item(order: number, overrides: Partial<RegressionItem> = {}): RegressionItem {
  return {
    id: `i${order}`,
    testCaseId: `tc${order}`,
    testCaseKey: `WEB-TC-${order}`,
    order,
    title: `Case ${order}`,
    preconditions: null,
    steps: ['Step'],
    expectedResult: null,
    automationReference: null,
    executionMode: 'Manual',
    status: 'WaitingForExecution',
    autoPassed: false,
    assignee: null,
    resultNote: null,
    executedAt: null,
    executedBy: null,
    bug: null,
    url: '',
    rowVersion: 1,
    ...overrides,
  };
}

class FakeApi {
  session = {
    key: 'WEB-R-1',
    projectKey: 'WEB',
    status: 'InProgress',
    summary,
    items: [item(1), item(2)],
    permissions: { canExecute: true, canAssign: false, canComplete: true, canCancel: true },
  } as unknown as RegressionSession;
  get = () => of(this.session);
  record = vi.fn<(s: string, k: string, body: unknown) => Observable<RegressionItemChange>>();
  bugDraft = () =>
    of({
      projectKey: 'WEB',
      title: '[Regression] Case 1',
      description: 'Found in…',
      type: 'Bug',
      severity: 'Major',
      priority: 'High',
      version: '1.0',
      labels: ['regression'],
      relatedTicket: null,
    });
  createBug =
    vi.fn<(s: string, k: string, overrides: BugOverrides) => Observable<RegressionItemChange>>();
}

describe('RegressionSessionStore', () => {
  let api: FakeApi;
  let toast: {
    error: ReturnType<typeof vi.fn>;
    success: ReturnType<typeof vi.fn>;
    warning: ReturnType<typeof vi.fn>;
  };
  let creator: { open: ReturnType<typeof vi.fn> };
  let store: RegressionSessionStore;

  beforeEach(async () => {
    api = new FakeApi();
    toast = { error: vi.fn(), success: vi.fn(), warning: vi.fn() };
    creator = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        RegressionSessionStore,
        { provide: RegressionsApi, useValue: api },
        { provide: ToastService, useValue: toast },
        { provide: TicketCreator, useValue: creator },
        {
          provide: AuthService,
          useValue: {
            currentUser: signal({ id: 'me', email: 'me@x', displayName: 'Me', globalRole: 'User' }),
          },
        },
      ],
    });
    store = TestBed.inject(RegressionSessionStore);
    await store.load('web-r-1', null);
  });

  it('focuses the first waiting item and applies a result optimistically, then the server answer', async () => {
    // Arrange
    const response = new Subject<RegressionItemChange>();
    api.record.mockReturnValue(response);

    // Act
    const pending = store.record(store.focused()!, 'Passed');
    const optimistic = store.items()[0];
    response.next({
      item: item(1, { status: 'Passed', assignee: me }),
      summary: { ...summary, passed: 1, waiting: 1, passRate: 1 },
      createdBug: null,
    });
    response.complete();
    await pending;

    // Assert
    expect(store.focusedKey()).toBe('WEB-TC-1');
    expect([optimistic.status, optimistic.assignee?.id]).toEqual(['Passed', 'me']);
    expect(store.summary()?.passed).toBe(1);
    expect(store.counts().waiting).toBe(1);
  });

  it('rolls a result back when the server rejects it', async () => {
    // Arrange
    api.record.mockReturnValue(throwError(() => new Error('boom')));

    // Act
    const recorded = await store.record(store.items()[1], 'Skipped');

    // Assert
    expect(recorded).toBeNull();
    expect(store.items()[1].status).toBe('WaitingForExecution');
    expect(toast.error).toHaveBeenCalledOnce();
  });

  it('opens the create dialog with the draft and creates the bug through the item', async () => {
    // Arrange
    const bug = { key: 'WEB-9', title: 'Export broken' } as TicketSummary;
    api.createBug.mockReturnValue(
      of({
        item: item(1, {
          status: 'Failed',
          bug: { id: 'b', key: 'WEB-9', title: 'x', status: 'ToDo', deleted: false, url: '' },
        }),
        summary,
        createdBug: bug,
      }),
    );
    creator.open.mockImplementation((prefill: CreateTicketPrefill) =>
      prefill.submit!('WEB', {
        title: 'Export broken',
        type: 'Bug',
        severity: 'Critical',
        priority: 'High',
        labels: ['regression'],
      }),
    );

    // Act
    const created = await store.createBug(store.items()[0]);

    // Assert
    const prefill = creator.open.mock.calls[0][0] as CreateTicketPrefill;
    expect([prefill.title, prefill.type, prefill.severity, prefill.heading]).toEqual([
      '[Regression] Case 1',
      'Bug',
      'Major',
      'Create bug from WEB-TC-1',
    ]);
    expect(api.createBug.mock.calls[0][2]).toMatchObject({
      title: 'Export broken',
      severity: 'Critical',
      priority: 'High',
      labels: ['regression'],
    });
    expect(created?.key).toBe('WEB-9');
    expect(store.items()[0].bug?.key).toBe('WEB-9');
  });
});
