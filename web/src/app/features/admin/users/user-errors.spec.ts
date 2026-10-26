import { ApiError } from '@core/api/api-error';
import { describeUserRule } from './user-errors';

describe('describeUserRule', () => {
  it('lists the projects of a last-owner refusal', () => {
    // Arrange
    const error = new ApiError(
      409,
      'user.lastProjectOwner',
      'The user is the last owner of PAY, WEB.',
      {
        projects: ['PAY', 'WEB'],
      },
    );

    // Act
    const problem = describeUserRule(error, 'Jane Doe');

    // Assert
    expect(problem?.title).toBe('Jane Doe still owns projects');
    expect(problem?.projects).toEqual(['PAY', 'WEB']);
  });

  it('explains the last-admin rule', () => {
    // Act
    const problem = describeUserRule(new ApiError(409, 'user.lastAdmin', 'x'), 'Ann');

    // Assert
    expect(problem?.message).toContain('last active administrator');
  });

  it('returns null for errors that are not user rules', () => {
    // Act / Assert
    expect(describeUserRule(new ApiError(500, 'internal', 'boom'), 'Ann')).toBeNull();
  });
});
