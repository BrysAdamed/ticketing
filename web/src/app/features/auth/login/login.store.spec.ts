import { ApiError } from '@core/api/api-error';
import { loginErrorMessage } from './login.store';

describe('login error messages', () => {
  it('gives one answer for wrong, unknown and locked accounts, mentioning the pause', () => {
    // Arrange
    const error = new ApiError(
      401,
      'auth.invalidCredentials',
      'The email or password is incorrect.',
    );

    // Act
    const message = loginErrorMessage(error);

    // Assert
    expect(message).toContain('Email or password is incorrect.');
    expect(message).toContain('15 minutes');
  });

  it('explains the per-network rate limit', () => {
    // Act / Assert
    expect(loginErrorMessage(new ApiError(429, 'rateLimited', 'Too many requests.'))).toBe(
      'Too many sign-in attempts. Wait a minute and try again.',
    );
  });

  it('points at fields on validation errors and falls back to the server title', () => {
    // Act / Assert
    expect(
      loginErrorMessage(new ApiError(400, 'validation', 'Invalid.', { email: ['Required.'] })),
    ).toBe('Check the highlighted fields.');
    expect(loginErrorMessage(new ApiError(500, 'internal', 'Something broke.'))).toBe(
      'Something broke.',
    );
  });
});
