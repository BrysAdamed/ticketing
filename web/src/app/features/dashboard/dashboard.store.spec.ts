import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiClient } from '@core/api/api-client';
import { FieldHints } from '@core/tickets/field-hints';
import { TicketEvents } from '@core/tickets/ticket-events';
import { Observable, Subject } from 'rxjs';
import { ProjectDashboard } from './dashboard.model';
import { DashboardStore } from './dashboard.store';

function dashboard(version: string | null): ProjectDashboard {
  return {
    projectKey: 'WEB',
    version,
    generatedAt: '2026-10-27T10:00:00Z',
    totals: { openTickets: 1, doneTickets: 0, openStoryPoints: 0, unassignedOpenTickets: 1 },
    byStatus: [],
    byType: [],
    byPriority: [],
    openBugsBySeverity: [],
    createdVsResolved: [],
    openByAssignee: { top: [], unassigned: 1, others: 0 },
    stale: { count: 0, olderThanDays: 30, updatedBefore: '2026-09-27T10:00:00Z', oldest: [] },
    epicProgress: { openEpics: 0, epics: [] },
    testCases: { total: 0, byStatus: [], automationRatio: null },
    regressions: { latest: null, recentPassRates: [] },
    regressionBugs: { count: 0, items: [] },
  };
}

describe('DashboardStore', () => {
  let requests: { path: string; query: unknown; response: Subject<ProjectDashboard> }[];
  let store: DashboardStore;

  beforeEach(() => {
    requests = [];
    const api = {
      get: (path: string, query: unknown): Observable<ProjectDashboard> => {
        const response = new Subject<ProjectDashboard>();
        requests.push({ path, query, response });
        return response;
      },
    };
    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        DashboardStore,
        { provide: ApiClient, useValue: api },
        { provide: FieldHints, useValue: { get: () => Promise.resolve(['2.0', '1.9']) } },
        TicketEvents,
      ],
    });
    store = TestBed.inject(DashboardStore);
  });

  function respond(index: number, data: ProjectDashboard): Promise<void> {
    requests[index].response.next(data);
    requests[index].response.complete();
    return Promise.resolve().then(() => undefined);
  }

  it('loads the dashboard with the version filter and the version hints', async () => {
    // Act
    store.load('web', '2.0');
    await respond(0, dashboard('2.0'));
    await vi.waitFor(() => expect(store.phase()).toBe('ready'));

    // Assert
    expect(requests[0].path).toBe('/projects/WEB/dashboard');
    expect(requests[0].query).toEqual({ version: '2.0' });
    expect(store.data()?.version).toBe('2.0');
    expect(store.versions()).toEqual(['2.0', '1.9']);
  });

  it('does not refetch for the same project and version', async () => {
    // Arrange
    store.load('WEB', null);
    await respond(0, dashboard(null));
    await vi.waitFor(() => expect(store.phase()).toBe('ready'));

    // Act
    store.load('WEB', null);

    // Assert
    expect(requests).toHaveLength(1);
  });

  it('keeps the current numbers on screen while a new version loads', async () => {
    // Arrange
    store.load('WEB', null);
    await respond(0, dashboard(null));
    await vi.waitFor(() => expect(store.phase()).toBe('ready'));

    // Act
    store.load('WEB', '2.0');

    // Assert
    expect(store.refreshing()).toBe(true);
    expect(store.phase()).toBe('ready');
    expect(store.data()?.version).toBeNull();
    await respond(1, dashboard('2.0'));
    await vi.waitFor(() => expect(store.data()?.version).toBe('2.0'));
    expect(store.refreshing()).toBe(false);
  });

  it('ignores a slow response that a newer request overtook', async () => {
    // Arrange
    store.load('WEB', '1.9');
    store.load('WEB', '2.0');

    // Act
    await respond(1, dashboard('2.0'));
    await vi.waitFor(() => expect(store.data()?.version).toBe('2.0'));
    await respond(0, dashboard('1.9'));

    // Assert
    expect(store.data()?.version).toBe('2.0');
  });

  it('treats an empty project without a filter as empty', async () => {
    // Arrange
    const empty = dashboard(null);
    empty.totals = { openTickets: 0, doneTickets: 0, openStoryPoints: 0, unassignedOpenTickets: 0 };

    // Act
    store.load('WEB', null);
    await respond(0, empty);
    await vi.waitFor(() => expect(store.phase()).toBe('ready'));

    // Assert
    expect(store.isEmpty()).toBe(true);
  });
});
