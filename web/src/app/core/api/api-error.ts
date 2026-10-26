import { HttpErrorResponse } from '@angular/common/http';

/// RFC 9457 problem details as returned by the API (see docs/architecture/api-conventions.md).
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  errors?: Record<string, string[]>;
  traceId?: string;
}

/// Every failed API call surfaces as an ApiError. `code` is the stable machine code from the
/// server (for example `ticket.parent.cycle`), or `network` / `http.<status>` when the response
/// carried no problem details.
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly title: string,
    readonly fieldErrors: Readonly<Record<string, readonly string[]>> = {},
    readonly detail?: string,
    readonly traceId?: string,
    readonly retryAfterSeconds?: number,
  ) {
    super(title);
    this.name = 'ApiError';
  }

  get isNotFound(): boolean {
    return this.status === 404;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }

  get isValidation(): boolean {
    return this.status === 400 && Object.keys(this.fieldErrors).length > 0;
  }

  get isUnauthenticated(): boolean {
    return this.status === 401;
  }

  fieldError(field: string): string | null {
    const key = Object.keys(this.fieldErrors).find((k) => k.toLowerCase() === field.toLowerCase());
    return key ? (this.fieldErrors[key]?.[0] ?? null) : null;
  }
}

const FALLBACK_TITLES: Record<number, string> = {
  0: 'Cannot reach the server. Check your connection and try again.',
  400: 'The request was not valid.',
  401: 'Your session has expired. Sign in again.',
  403: "You don't have permission to do that.",
  404: "It doesn't exist or was moved.",
  409: 'Someone else changed this in the meantime. Reload and try again.',
  423: 'The account is locked.',
  429: 'Too many requests. Wait a moment and try again.',
};

export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (!(error instanceof HttpErrorResponse)) {
    const message = error instanceof Error ? error.message : 'Unexpected error.';
    return new ApiError(-1, 'client', message);
  }

  const status = error.status;
  const problem = asProblem(error.error);
  const code = problem?.code ?? (status === 0 ? 'network' : `http.${status}`);
  const title =
    problem?.title ??
    FALLBACK_TITLES[status] ??
    (status >= 500 ? 'Something went wrong on the server.' : error.message);
  const retryAfter = Number(error.headers?.get('Retry-After'));

  return new ApiError(
    status,
    code,
    title,
    normalizeFieldErrors(problem?.errors),
    problem?.detail,
    problem?.traceId,
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
  );
}

function asProblem(body: unknown): ProblemDetails | null {
  if (typeof body === 'string') {
    try {
      return asProblem(JSON.parse(body));
    } catch {
      return null;
    }
  }
  return body !== null && typeof body === 'object' ? (body as ProblemDetails) : null;
}

function normalizeFieldErrors(errors: unknown): Record<string, string[]> {
  if (!errors || typeof errors !== 'object') return {};
  const result: Record<string, string[]> = {};
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    const key = field.length > 0 ? field[0].toLowerCase() + field.slice(1) : field;
    result[key] = Array.isArray(messages) ? messages.map(String) : [String(messages)];
  }
  return result;
}
