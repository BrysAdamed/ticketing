import { DashboardLinks } from './dashboard-links';
import { ProjectDashboard } from './dashboard.model';
import { assigneeItems, categorySegments, percent, severityItems } from './dashboard-widgets';

function dashboard(overrides: Partial<ProjectDashboard> = {}): ProjectDashboard {
  return {
    projectKey: 'WEB',
    version: null,
    generatedAt: '2026-10-27T10:00:00Z',
    totals: { openTickets: 0, doneTickets: 0, openStoryPoints: 0, unassignedOpenTickets: 0 },
    byStatus: [],
    byType: [],
    byPriority: [],
    openBugsBySeverity: [],
    createdVsResolved: [],
    openByAssignee: { top: [], unassigned: 0, others: 0 },
    stale: { count: 0, olderThanDays: 30, updatedBefore: '2026-09-27T10:00:00Z', oldest: [] },
    epicProgress: { openEpics: 0, epics: [] },
    testCases: { total: 0, byStatus: [], automationRatio: null },
    regressions: { latest: null, recentPassRates: [] },
    regressionBugs: { count: 0, items: [] },
    ...overrides,
  };
}

describe('dashboard widgets', () => {
  const links = new DashboardLinks('WEB', null);

  it('rolls statuses up into category segments that add up to 100%', () => {
    // Arrange
    const data = dashboard({
      byStatus: [
        { status: 'ToDo', category: 'ToDo', count: 2 },
        { status: 'InProgress', category: 'InProgress', count: 1 },
        { status: 'OnHold', category: 'InProgress', count: 3 },
        { status: 'Done', category: 'Done', count: 2 },
      ],
    });

    // Act
    const segments = categorySegments(data);

    // Assert
    expect(segments.map((s) => [s.category, s.count, s.share])).toEqual([
      ['ToDo', 2, 25],
      ['InProgress', 4, 50],
      ['Done', 2, 25],
    ]);
    expect(segments[1].color).toBe('var(--tk-category-inprogress)');
  });

  it('shows unassigned always and others only when there are any', () => {
    // Arrange
    const user = { id: 'u1', email: 'a@x.test', displayName: 'Anna', isActive: false };
    const data = dashboard({
      openByAssignee: { top: [{ user, count: 5 }], unassigned: 0, others: 2 },
    });

    // Act
    const items = assigneeItems(data, links);

    // Assert
    expect(items.map((i) => [i.id, i.label, i.count])).toEqual([
      ['u1', 'Anna (deactivated)', 5],
      ['unassigned', 'Unassigned', 0],
      ['others', 'Others', 2],
    ]);
    expect(items[2].link?.query['assigneeNot']).toBe('u1,unassigned');
  });

  it('uses the severity tokens and a muted none bucket', () => {
    // Arrange
    const data = dashboard({
      openBugsBySeverity: [
        { severity: 'Critical', count: 1 },
        { severity: null, count: 4 },
      ],
    });

    // Act
    const items = severityItems(data, links);

    // Assert
    expect(items[0].color).toBe('var(--tk-severity-critical)');
    expect(items[1]).toMatchObject({ id: 'none', label: 'No severity', muted: true });
    expect(items[1].link?.query['severity']).toBe('none');
  });

  it('computes whole percentages and nothing for an empty whole', () => {
    expect(percent(1, 3)).toBe(33);
    expect(percent(0, 0)).toBeNull();
  });
});
