import { DashboardLinks, weekEnd } from './dashboard-links';

describe('DashboardLinks', () => {
  it('scopes every ticket search to the project and the version filter', () => {
    // Arrange
    const links = new DashboardLinks('WEB', '1.4.0');

    // Act
    const link = links.openBugsWithSeverity('Critical');

    // Assert
    expect(link).toEqual({
      path: '/search',
      query: {
        project: 'WEB',
        type: 'Bug',
        severity: 'Critical',
        category: 'ToDo,InProgress',
        version: '1.4.0',
      },
    });
  });

  it('omits the version when the dashboard is not filtered and maps no severity to none', () => {
    // Arrange
    const links = new DashboardLinks('WEB', null);

    // Act
    const link = links.openBugsWithSeverity(null);

    // Assert
    expect(link.query).toEqual({
      project: 'WEB',
      type: 'Bug',
      severity: 'none',
      category: 'ToDo,InProgress',
    });
  });

  it('links a week to whole UTC days, Monday to Sunday', () => {
    // Arrange
    const links = new DashboardLinks('WEB', null);
    const week = { weekStart: '2026-10-19', isoWeek: '2026-W43', created: 3, resolved: 1 };

    // Act
    const created = links.createdIn(week);
    const resolved = links.resolvedIn(week);

    // Assert
    expect(created.query).toMatchObject({ createdFrom: '2026-10-19', createdTo: '2026-10-25' });
    expect(resolved.query).toMatchObject({ resolvedFrom: '2026-10-19', resolvedTo: '2026-10-25' });
  });

  it('builds the others bucket by excluding the top assignees and unassigned', () => {
    // Arrange
    const links = new DashboardLinks('WEB', null);

    // Act
    const link = links.openAssignedToOthers(['u1', 'u2']);

    // Assert
    expect(link.query).toEqual({
      project: 'WEB',
      assigneeNot: 'u1,u2,unassigned',
      category: 'ToDo,InProgress',
    });
  });

  it('sorts stale tickets oldest first and bounds them by the cut-off instant', () => {
    // Arrange
    const links = new DashboardLinks('WEB', null);

    // Act
    const link = links.stale('2026-09-27T10:00:00Z');

    // Assert
    expect(link.query).toEqual({
      project: 'WEB',
      category: 'ToDo,InProgress',
      updatedTo: '2026-09-27T10:00:00Z',
      sort: 'updated',
      order: 'asc',
    });
  });

  it('links epic children and only the done ones', () => {
    // Arrange
    const links = new DashboardLinks('WEB', null);

    // Act
    const all = links.children('WEB-12');
    const done = links.children('WEB-12', true);

    // Assert
    expect(all.query).toEqual({ project: 'WEB', parent: 'WEB-12', sort: 'rank' });
    expect(done.query).toEqual({ project: 'WEB', parent: 'WEB-12', status: 'Done', sort: 'rank' });
  });

  it('links test cases and sessions to their project pages without search filters', () => {
    // Arrange
    const links = new DashboardLinks('WEB', '1.4.0');

    // Act
    const testCases = links.testCases('Manual');
    const session = links.regressionSession('WEB-R-3');

    // Assert
    expect(testCases).toEqual({ path: '/projects/WEB/test-cases', query: { status: 'Manual' } });
    expect(session).toEqual({ path: '/projects/WEB/regressions/WEB-R-3', query: {} });
  });
});

describe('weekEnd', () => {
  it('crosses month and year boundaries', () => {
    expect(weekEnd('2026-12-28')).toBe('2027-01-03');
  });
});
