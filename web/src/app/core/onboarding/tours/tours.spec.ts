import { planTour } from '../engine/tour-logic';
import { TourAccess } from '../engine/tour.model';
import { GUIDE_ID_PATTERN } from '../onboarding.models';
import { BACKLOG_TOUR } from './backlog.tours';
import { TOUR_CATALOGUE, tourGuideId } from './tour-catalogue';

const WRITER: TourAccess = { canWrite: true, isOwner: false, isAdmin: false };
const VIEWER: TourAccess = { canWrite: false, isOwner: false, isAdmin: false };

function plan(access: TourAccess, anchors: readonly string[]) {
  return planTour(BACKLOG_TOUR, access, {
    url: '/projects/WEB/backlog',
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
