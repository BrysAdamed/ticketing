import { fillRoute, isAllowed, isOnPath, planTour, spotlightHole, stepLabel } from './tour-logic';
import { TourAccess, TourDefinition, TourStep } from './tour.model';

const viewer: TourAccess = { canWrite: false, isOwner: false, isAdmin: false };
const member: TourAccess = { canWrite: true, isOwner: false, isAdmin: false };

const step = (id: string, extra: Partial<TourStep> = {}): TourStep => ({
  id,
  anchor: `a.${id}`,
  title: id,
  body: id,
  ...extra,
});

const tour = (...steps: TourStep[]): TourDefinition => ({
  id: 'tour.test',
  version: 1,
  viewId: 'test.view',
  title: 'Test',
  steps,
});

const anchors =
  (...ids: string[]) =>
  (anchor: string) =>
    ids.includes(anchor);

describe('tour logic', () => {
  it('shows a step only to roles that meet its requirement', () => {
    expect(isAllowed(step('x'), viewer)).toBe(true);
    expect(isAllowed(step('x', { requires: 'write' }), viewer)).toBe(false);
    expect(isAllowed(step('x', { requires: 'write' }), member)).toBe(true);
    expect(isAllowed(step('x', { requires: 'owner' }), member)).toBe(false);
    expect(isAllowed(step('x', { requires: 'admin' }), { ...member, isAdmin: true })).toBe(true);
  });

  it('fills route params and refuses a missing one', () => {
    expect(fillRoute('/projects/:projectKey/backlog', { projectKey: 'PAY' })).toBe(
      '/projects/PAY/backlog',
    );
    expect(() => fillRoute('/projects/:projectKey', {})).toThrow(/projectKey/);
  });

  it('compares paths without query, fragment, trailing slash or case', () => {
    expect(isOnPath('/projects/pay/backlog?peek=PAY-1#x', '/projects/PAY/backlog/')).toBe(true);
    expect(isOnPath('/projects/PAY/boards', '/projects/PAY/backlog')).toBe(false);
  });

  it('drops write steps for a viewer and skips steps whose anchor is missing', () => {
    // Arrange
    const definition = tour(step('a'), step('b', { requires: 'write' }), step('c'), step('d'));

    // Act
    const plan = planTour(definition, viewer, {
      url: '/x',
      params: {},
      hasAnchor: anchors('a.a', 'a.b', 'a.c'),
    });

    // Assert
    expect(plan.steps.map((s) => s.id)).toEqual(['a', 'c']);
    expect(plan.skipped.map((s) => s.id)).toEqual(['d']);
    expect(plan.abort).toBe(false);
  });

  it('aborts when fewer than half of the local anchors resolve', () => {
    // Arrange
    const definition = tour(step('a'), step('b'), step('c'));

    // Act
    const plan = planTour(definition, member, {
      url: '/x',
      params: {},
      hasAnchor: anchors('a.a'),
    });

    // Assert
    expect(plan.abort).toBe(true);
  });

  it('aborts when the role filter leaves nothing to show', () => {
    const plan = planTour(tour(step('a', { requires: 'owner' })), member, {
      url: '/x',
      params: {},
      hasAnchor: () => true,
    });

    expect(plan.abort).toBe(true);
  });

  it('keeps steps on another route for later and checks only the local anchors', () => {
    // Arrange
    const definition = tour(
      step('here'),
      step('there', { route: '/projects/:projectKey/backlog' }),
      step('also-there', { route: '/projects/:projectKey/backlog' }),
    );

    // Act
    const plan = planTour(definition, member, {
      url: '/dev/ui-kit',
      params: { projectKey: 'PAY' },
      hasAnchor: anchors('a.here'),
    });

    // Assert
    expect(plan.steps.map((s) => s.id)).toEqual(['here', 'there', 'also-there']);
    expect(plan.abort).toBe(false);
  });

  it('labels steps from one', () => {
    expect(stepLabel(0, 3)).toBe('Step 1 of 3');
  });

  it('pads the spotlight hole and clips it to the viewport', () => {
    const viewport = { width: 800, height: 600 };

    expect(spotlightHole({ x: 100, y: 50, width: 80, height: 28 }, viewport, 6)).toEqual({
      x: 94,
      y: 44,
      width: 92,
      height: 40,
    });
    expect(spotlightHole({ x: 2, y: 580, width: 100, height: 40 }, viewport, 6)).toEqual({
      x: 0,
      y: 574,
      width: 108,
      height: 26,
    });
  });

  it('has no spotlight hole for a hidden or off-screen anchor', () => {
    const viewport = { width: 800, height: 600 };

    expect(spotlightHole({ x: 10, y: 10, width: 0, height: 0 }, viewport, 6)).toBeNull();
    expect(spotlightHole({ x: 10, y: 900, width: 50, height: 20 }, viewport, 6)).toBeNull();
  });
});
