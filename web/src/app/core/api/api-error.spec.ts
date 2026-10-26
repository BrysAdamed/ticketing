import { HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { ApiError, toApiError } from './api-error';

describe('toApiError', () => {
  it('maps RFC 9457 problem details with code and field errors', () => {
    // Arrange
    const response = new HttpErrorResponse({
      status: 409,
      error: {
        type: 'https://ticketing/errors/ticket.parent.cycle',
        title: 'Setting this parent would create a cycle.',
        status: 409,
        code: 'ticket.parent.cycle',
        errors: { ParentKey: ['WEB-9 is a descendant of WEB-4.'] },
        traceId: 'abc',
      },
    });

    // Act
    const error = toApiError(response);

    // Assert
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(409);
    expect(error.code).toBe('ticket.parent.cycle');
    expect(error.title).toBe('Setting this parent would create a cycle.');
    expect(error.fieldErrors).toEqual({ parentKey: ['WEB-9 is a descendant of WEB-4.'] });
    expect(error.fieldError('parentkey')).toBe('WEB-9 is a descendant of WEB-4.');
    expect(error.traceId).toBe('abc');
    expect(error.isConflict).toBe(true);
  });

  it('flags validation errors', () => {
    // Arrange
    const response = new HttpErrorResponse({
      status: 400,
      error: { title: 'Invalid', code: 'validation', errors: { title: ['Required.'] } },
    });

    // Act
    const error = toApiError(response);

    // Assert
    expect(error.isValidation).toBe(true);
    expect(error.fieldError('title')).toBe('Required.');
  });

  it('parses problem details delivered as a JSON string', () => {
    // Act
    const error = toApiError(
      new HttpErrorResponse({
        status: 401,
        error: '{"code":"auth.invalidCredentials","title":"Nope"}',
      }),
    );

    // Assert
    expect(error.code).toBe('auth.invalidCredentials');
    expect(error.isUnauthenticated).toBe(true);
  });

  it('falls back to http.<status> and a friendly title without problem details', () => {
    // Act
    const error = toApiError(new HttpErrorResponse({ status: 404, error: null }));

    // Assert
    expect(error.code).toBe('http.404');
    expect(error.title).toContain("doesn't exist");
    expect(error.isNotFound).toBe(true);
  });

  it('maps network failures to code "network"', () => {
    // Act
    const error = toApiError(
      new HttpErrorResponse({ status: 0, error: new ProgressEvent('error') }),
    );

    // Assert
    expect(error.code).toBe('network');
  });

  it('reads Retry-After for rate limiting', () => {
    // Act
    const error = toApiError(
      new HttpErrorResponse({
        status: 429,
        headers: new HttpHeaders({ 'Retry-After': '30' }),
        error: { code: 'rateLimited', title: 'Slow down' },
      }),
    );

    // Assert
    expect(error.retryAfterSeconds).toBe(30);
  });

  it('wraps non-HTTP errors and passes ApiError through', () => {
    // Arrange
    const existing = new ApiError(409, 'x', 'y');

    // Act & Assert
    expect(toApiError(existing)).toBe(existing);
    expect(toApiError(new Error('boom')).code).toBe('client');
  });
});
