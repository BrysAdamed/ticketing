import { HttpContextToken, HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { UnauthenticatedHandler } from './unauthenticated-handler';
import { toApiError } from './api-error';

/// Set to true on requests whose 401 is an expected answer (login, session probe) rather than
/// an expired session, so the interceptor doesn't redirect to /login.
export const SKIP_AUTH_REDIRECT = new HttpContextToken<boolean>(() => false);

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const unauthenticated = inject(UnauthenticatedHandler);
  return next(req).pipe(
    catchError((error: unknown) => {
      if (
        error instanceof HttpErrorResponse &&
        error.status === 401 &&
        !req.context.get(SKIP_AUTH_REDIRECT)
      ) {
        unauthenticated.handle();
      }
      return throwError(() => toApiError(error));
    }),
  );
};
