import { planTour } from '../engine/tour-logic';
import { TourAccess, TourDefinition } from '../engine/tour.model';
import { GUIDE_ID_PATTERN } from '../onboarding.models';
import { ADMIN_USERS_TOUR } from './admin-users.tours';
import { BACKLOG_TOUR } from './backlog.tours';
import { BOARD_TOUR } from './board.tours';
import { DASHBOARD_TOUR, DASHBOARD_TOUR_STEPS } from './dashboard.tours';
import { PROJECT_SETTINGS_TOUR } from './project-settings.tours';
import { REGRESSION_SESSION_TOUR } from './regressions.tours';
import { SEARCH_TOUR } from './search.tours';
import { TEST_CASES_TOUR } from './test-cases.tours';
import { TICKET_TOUR } from './ticket.tours';
import { pathNeedsProject, TOUR_CATALOGUE, tourGuideId } from './tour-catalogue';

const WRITER: TourAccess = { canWrite: true, isOwner: false, isAdmin: false };
const VIEWER: TourAccess = { canWrite: false, isOwner: false, isAdmin: false };

function plan(access: TourAccess, anchors: readonly string[], tour = BACKLOG_TOUR) {
  return planTour(tour, access, {
    url: '/somewhere',
    params: {},
    hasAnchor: (anchor) => anchors.includes(anchor),
  });
}

const ALL_ANCHORS = BACKLOG_TOUR.steps.map((s) => s.anchor);

describe('tour catalogue', () => {
  it('loads a definition per entry whose ids, view and title match the entry', async () => {
    for (const entry of TOUR_CATALOGUE) {
      // Act
      const tour = await entry.load();

      // Assert
      expect(tour.viewId).toBe(entry.viewId);
      expect(tour.title).toBe(entry.title);
      expect(tour.id).toBe(tourGuideId(entry.viewId));
      expect(GUIDE_ID_PATTERN.test(tour.id)).toBe(true);
      expect(tour.version).toBeGreaterThanOrEqual(1);
      expect(new Set(tour.steps.map((s) => s.id)).size).toBe(tour.steps.length);
      for (const step of tour.steps) expect(step.anchor).toMatch(/^[a-z-]+(\.[a-z-]+)+$/);
    }
  });

  it('has one entry per view', () => {
    // Act
    const viewIds = TOUR_CATALOGUE.map((e) => e.viewId);

    // Assert
    expect(new Set(viewIds).size).toBe(viewIds.length);
  });
});

describe('tour audiences', () => {
  const OWNER: TourAccess = { canWrite: true, isOwner: true, isAdmin: false };
  const ADMIN: TourAccess = { canWrite: false, isOwner: false, isAdmin: true };
  const anchorsOf = (tour: TourDefinition) => tour.steps.map((s) => s.anchor);
  const planOn = (tour: TourDefinition, access: TourAccess, anchors = anchorsOf(tour)) =>
    planTour(tour, access, { url: '/x', params: {}, hasAnchor: (a) => anchors.includes(a) });
  const ids = (steps: readonly { id: string }[]) => steps.map((s) => s.id);

  it('keeps every new tour between three and six steps', () => {
    for (const tour of [
      DASHBOARD_TOUR,
      SEARCH_TOUR,
      TEST_CASES_TOUR,
      REGRESSION_SESSION_TOUR,
      PROJECT_SETTINGS_TOUR,
      ADMIN_USERS_TOUR,
    ]) {
      expect(tour.steps.length).toBeGreaterThanOrEqual(3);
      expect(tour.steps.length).toBeLessThanOrEqual(6);
    }
  });

  it('shows the read-only tours (dashboard, search) to a Viewer in full', () => {
    // Act
    const dashboard = planOn(DASHBOARD_TOUR, VIEWER);
    const search = planOn(SEARCH_TOUR, VIEWER);

    // Assert
    expect(ids(dashboard.steps)).toEqual(ids(DASHBOARD_TOUR.steps));
    expect(ids(search.steps)).toEqual(ids(SEARCH_TOUR.steps));
  });

  it('exports the dashboard steps on their own for the first-project walkthrough', () => {
    expect(DASHBOARD_TOUR.steps).toBe(DASHBOARD_TOUR_STEPS);
    expect(ids(DASHBOARD_TOUR_STEPS)).toEqual([
      'totals',
      'count-links',
      'by-status',
      'created-resolved',
      'epic-progress',
    ]);
  });

  it('hides the write steps of test cases and regression sessions from a Viewer', () => {
    // Act
    const testCases = planOn(TEST_CASES_TOUR, VIEWER);
    const session = planOn(REGRESSION_SESSION_TOUR, VIEWER);
    const writerSession = planOn(REGRESSION_SESSION_TOUR, WRITER);

    // Assert
    expect(ids(testCases.steps)).toEqual(['statuses', 'list', 'last-result', 'filters']);
    expect(ids(session.steps)).toEqual(['progress', 'items']);
    expect(ids(writerSession.steps)).toEqual(['progress', 'items', 'take', 'record', 'create-bug']);
  });

  it('still starts the test cases tour on an empty list, without the last-result step', () => {
    // Act
    const result = planOn(
      TEST_CASES_TOUR,
      WRITER,
      anchorsOf(TEST_CASES_TOUR).filter((a) => a !== 'testcases.last-result'),
    );

    // Assert
    expect(result.abort).toBe(false);
    expect(ids(result.skipped)).toEqual(['last-result']);
  });

  it('runs the project settings tour for Owners only and the users tour for Admins only', () => {
    // Act / Assert
    expect(planOn(PROJECT_SETTINGS_TOUR, OWNER).steps).toHaveLength(
      PROJECT_SETTINGS_TOUR.steps.length,
    );
    expect(planOn(PROJECT_SETTINGS_TOUR, WRITER).abort).toBe(true);
    expect(planOn(PROJECT_SETTINGS_TOUR, ADMIN).abort).toBe(true);
    expect(planOn(ADMIN_USERS_TOUR, ADMIN).steps).toHaveLength(ADMIN_USERS_TOUR.steps.length);
    expect(planOn(ADMIN_USERS_TOUR, OWNER).abort).toBe(true);
  });

  it('declares the same audience on the catalogue entry as on every step of the tour', async () => {
    for (const entry of TOUR_CATALOGUE.filter((e) => e.requires)) {
      // Act
      const tour = await entry.load();

      // Assert
      expect(tour.steps.every((s) => s.requires === entry.requires)).toBe(true);
    }
  });

  it('opens search and users without a project, and offers project-role tours on their view only', () => {
    // Act
    const withoutProject = TOUR_CATALOGUE.filter((e) => e.path && !pathNeedsProject(e.path));
    const projectRoleWithPath = TOUR_CATALOGUE.filter(
      (e) => e.path && (e.requires === 'write' || e.requires === 'owner'),
    );

    // Assert
    expect(withoutProject.map((e) => e.viewId)).toEqual(
      expect.arrayContaining(['search.results', 'admin.users']),
    );
    expect(projectRoleWithPath).toEqual([]);
  });
});

describe('backlog tour', () => {
  it('shows a writer every step when every anchor is on the page', () => {
    // Act
    const result = plan(WRITER, ALL_ANCHORS);

    // Assert
    expect(result.abort).toBe(false);
    expect(result.steps.map((s) => s.id)).toEqual([
      'quick-create',
      'list',
      'rank',
      'bulk',
      'group-sort',
      'on-boards',
    ]);
  });

  it('hides the write steps from a Viewer', () => {
    // Act
    const result = plan(VIEWER, ALL_ANCHORS);

    // Assert
    expect(result.steps.map((s) => s.id)).toEqual(['list', 'group-sort', 'on-boards']);
    expect(result.steps.some((s) => s.requires)).toBe(false);
  });

  it('skips the row and "on boards" steps on an empty backlog but still starts', () => {
    // Act
    const result = plan(WRITER, ['backlog.quick-create', 'backlog.list', 'backlog.group-sort']);

    // Assert
    expect(result.abort).toBe(false);
    expect(result.steps.map((s) => s.id)).toEqual(['quick-create', 'list', 'group-sort']);
    expect(result.skipped.map((s) => s.id)).toEqual(['rank', 'bulk', 'on-boards']);
  });

  it('does not start when fewer than half of the anchors resolve', () => {
    // Act
    const writer = plan(WRITER, ['backlog.group-sort', 'backlog.quick-create']);
    const viewer = plan(VIEWER, ['backlog.group-sort']);

    // Assert
    expect(writer.abort).toBe(true);
    expect(viewer.abort).toBe(true);
  });
});

describe('board tour', () => {
  const anchors = BOARD_TOUR.steps.map((s) => s.anchor);

  it('is in the catalogue for the board view, which has no project path', () => {
    // Act
    const entry = TOUR_CATALOGUE.find((e) => e.viewId === 'board.kanban');

    // Assert
    expect(entry?.title).toBe(BOARD_TOUR.title);
    expect(entry?.path).toBeUndefined();
  });

  it('shows a writer columns, swimlanes, placing cards and the hidden cards note', () => {
    // Act
    const result = plan(WRITER, anchors, BOARD_TOUR);

    // Assert
    expect(result.abort).toBe(false);
    expect(result.steps.map((s) => s.id)).toEqual([
      'columns',
      'swimlanes',
      'place',
      'hidden-cards',
    ]);
  });

  it('gives a Viewer the tour without the placing step', () => {
    // Act
    const result = plan(VIEWER, anchors, BOARD_TOUR);

    // Assert
    expect(result.steps.map((s) => s.id)).toEqual(['columns', 'swimlanes', 'hidden-cards']);
    expect(result.steps.some((s) => s.requires)).toBe(false);
  });

  it('never mentions how many cards are hidden', () => {
    // Arrange
    const step = BOARD_TOUR.steps.find((s) => s.id === 'hidden-cards')!;

    // Assert
    expect(step.body).not.toMatch(/\d/);
    expect(step.requires).toBeUndefined();
  });
});

describe('ticket tour', () => {
  const anchors = TICKET_TOUR.steps.map((s) => s.anchor);
  const withoutDelegate = anchors.filter((a) => a !== 'ticket.delegate');

  it('is in the catalogue for the ticket view, which has no project path', () => {
    // Act
    const entry = TOUR_CATALOGUE.find((e) => e.viewId === 'ticket.detail');

    // Assert
    expect(entry?.title).toBe(TICKET_TOUR.title);
    expect(entry?.path).toBeUndefined();
  });

  it('shows a writer every step, Delegate last, when delegation is on', () => {
    // Act
    const result = plan(WRITER, anchors, TICKET_TOUR);

    // Assert
    expect(result.steps.map((s) => s.id)).toEqual([
      'fields',
      'sub-tickets',
      'links',
      'watch',
      'mentions',
      'test-cases',
      'attachments',
      'delegate',
    ]);
  });

  it('points the Attachments step at the attachments section, for Viewers too', () => {
    // Arrange
    const step = TICKET_TOUR.steps.find((s) => s.id === 'attachments');

    // Assert
    expect(step?.anchor).toBe('ticket.attachments');
    expect(step?.requires).toBeUndefined();
    expect(TICKET_TOUR.version).toBeGreaterThanOrEqual(2);
  });

  it('skips Delegate when the Delegate button is not shown (flag off) and still starts', () => {
    // Act
    const result = plan(WRITER, withoutDelegate, TICKET_TOUR);

    // Assert
    expect(result.abort).toBe(false);
    expect(result.steps.map((s) => s.id)).not.toContain('delegate');
    expect(result.skipped.map((s) => s.id)).toEqual(['delegate']);
  });

  it('hides the write steps (@mentions, Delegate) from a Viewer', () => {
    // Act
    const result = plan(VIEWER, withoutDelegate, TICKET_TOUR);

    // Assert
    expect(result.abort).toBe(false);
    expect(result.steps.map((s) => s.id)).toEqual([
      'fields',
      'sub-tickets',
      'links',
      'watch',
      'test-cases',
      'attachments',
    ]);
    expect(result.skipped).toEqual([]);
  });
});
