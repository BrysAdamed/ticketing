import { TestCase } from '@core/testing/testing.models';
import { emptyForm, formFrom, moveStep, newStep, toNew, toPatch, validate } from './test-case-form';

const saved: TestCase = {
  id: '1',
  key: 'WEB-TC-1',
  projectId: 'p',
  projectKey: 'WEB',
  number: 1,
  title: 'Log in',
  preconditions: 'A user',
  steps: ['Open', 'Submit'],
  expectedResult: null,
  status: 'Manual',
  automationReference: null,
  ticket: { id: 't', key: 'WEB-4', title: 'Login', type: 'UserStory', status: 'ToDo' },
  archivedAt: null,
  archivedBy: null,
  createdAt: '2026-10-01T00:00:00Z',
  createdBy: { id: 'u', email: 'a@x', displayName: 'A', isActive: true },
  updatedAt: '2026-10-01T00:00:00Z',
  sessionCount: 0,
  recentRuns: [],
  permissions: { canEdit: true, canDelete: true },
  url: '/projects/WEB/test-cases/WEB-TC-1',
  rowVersion: 7,
};

describe('test case form', () => {
  it('requires a title and steps for Manual', () => {
    // Arrange
    const form = { ...emptyForm(), status: 'Manual' as const, steps: [newStep('  ')] };

    // Act
    const errors = validate(form);

    // Assert
    expect(errors.title).toBe('Title is required.');
    expect(errors.steps).toBe('A Manual test case needs at least one step.');
  });

  it('accepts an Automatic case without steps', () => {
    // Arrange
    const form = { ...emptyForm(), title: 'API smoke', status: 'Automatic' as const };

    // Act
    const errors = validate(form);

    // Assert
    expect(errors).toEqual({});
  });

  it('builds a create body with trimmed values and blank steps dropped', () => {
    // Arrange
    const form = {
      ...emptyForm('WEB-4'),
      title: ' Log in ',
      steps: [newStep(' Open '), newStep(''), newStep('Submit')],
      preconditions: '  ',
    };

    // Act
    const body = toNew(form);

    // Assert
    expect(body).toEqual({
      title: 'Log in',
      status: 'New',
      preconditions: null,
      steps: ['Open', 'Submit'],
      expectedResult: null,
      automationReference: null,
      ticketKey: 'WEB-4',
    });
  });

  it('patches only changed fields', () => {
    // Arrange
    const form = { ...formFrom(saved), preconditions: '', ticketKey: null };

    // Act
    const patch = toPatch(saved, form);

    // Assert
    expect(patch).toEqual({ preconditions: null, ticketKey: null });
    expect(toPatch(saved, formFrom(saved))).toEqual({});
  });

  it('sends the whole step list when steps are reordered', () => {
    // Arrange
    const form = formFrom(saved);

    // Act
    const patch = toPatch(saved, { ...form, steps: moveStep(form.steps, 1, 0) });

    // Assert
    expect(patch).toEqual({ steps: ['Submit', 'Open'] });
  });

  it('ignores moves outside the list', () => {
    // Arrange
    const steps = [newStep('a'), newStep('b')];

    // Act
    const moved = moveStep(steps, 0, 2);

    // Assert
    expect(moved.map((s) => s.text)).toEqual(['a', 'b']);
  });
});
