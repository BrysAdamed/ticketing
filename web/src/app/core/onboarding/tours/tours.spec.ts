import { planTour } from '../engine/tour-logic';
import { TourAccess } from '../engine/tour.model';
import { GUIDE_ID_PATTERN } from '../onboarding.models';
import { BACKLOG_TOUR } from './backlog.tours';
import { BOARD_TOUR } from './board.tours';
import { TICKET_TOUR } from './ticket.tours';
import { TOUR_CATALOGUE, tourGuideId } from './tour-catalogue';

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
      'delegate',
    ]);
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
    ]);
    expect(result.skipped).toEqual([]);
  });
});
