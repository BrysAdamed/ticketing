import { HttpClient, HttpContext, HttpHeaders, HttpParams } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { defer, finalize, Observable, share } from 'rxjs';
import { Page, PageRequest } from './page';

export const API_BASE_URL = '/api/v1';

export type QueryValue =
  string | number | boolean | null | undefined | readonly (string | number)[];
export type Query = Record<string, QueryValue>;

export interface RequestOptions {
  context?: HttpContext;
  idempotencyKey?: string;
}

export interface WriteOptions extends RequestOptions {
  /// Expected `rowVersion` of the resource; sent as `If-Match` so stale writes fail with
  /// 409 `concurrency.conflict` (then refetch).
  rowVersion?: number | string;
}

/// Thin typed wrapper over HttpClient for the Ticketing REST API. Paths are relative to
/// `/api/v1`. Errors arrive as `ApiError` (mapped by the API error interceptor). Identical GETs
/// in flight at the same time share one request; any write starts a new generation, so a GET
/// issued after a write never joins one that started before it.
@Injectable({ providedIn: 'root' })
export class ApiClient {
  private readonly http = inject(HttpClient);
  private readonly inFlight = new Map<string, Observable<unknown>>();

  get<T>(path: string, query?: Query, options?: RequestOptions): Observable<T> {
    const url = this.url(path);
    const params = toParams(query);
    if (options?.context) return this.http.get<T>(url, { params, context: options.context });
    const key = `${url}?${params.toString()}`;
    return defer(() => {
      const pending = this.inFlight.get(key) as Observable<T> | undefined;
      if (pending) return pending;
      const shared: Observable<T> = this.http.get<T>(url, { params }).pipe(
        finalize(() => {
          if (this.inFlight.get(key) === shared) this.inFlight.delete(key);
        }),
        share(),
      );
      this.inFlight.set(key, shared);
      return shared;
    });
  }

  list<T>(path: string, page?: PageRequest, query?: Query): Observable<Page<T>> {
    return this.get<Page<T>>(path, { ...query, limit: page?.limit, cursor: page?.cursor });
  }

  post<T>(path: string, body?: unknown, options?: RequestOptions): Observable<T> {
    this.inFlight.clear();
    return this.http.post<T>(this.url(path), body ?? null, {
      headers: headers(options),
      context: options?.context,
    });
  }

  put<T>(path: string, body: unknown, options?: WriteOptions): Observable<T> {
    this.inFlight.clear();
    return this.http.put<T>(this.url(path), body, {
      headers: headers(options),
      context: options?.context,
    });
  }

  patch<T>(path: string, body: unknown, options?: WriteOptions): Observable<T> {
    this.inFlight.clear();
    return this.http.patch<T>(this.url(path), body, {
      headers: headers(options),
      context: options?.context,
    });
  }

  delete<T = void>(path: string, options?: WriteOptions): Observable<T> {
    this.inFlight.clear();
    return this.http.delete<T>(this.url(path), {
      headers: headers(options),
      context: options?.context,
    });
  }

  url(path: string): string {
    return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
  }
}

function headers(options?: WriteOptions): HttpHeaders {
  let result = new HttpHeaders();
  if (options?.rowVersion !== undefined) result = result.set('If-Match', `"${options.rowVersion}"`);
  if (options?.idempotencyKey) result = result.set('Idempotency-Key', options.idempotencyKey);
  return result;
}

function toParams(query?: Query): HttpParams {
  let params = new HttpParams();
  if (!query) return params;
  for (const [key, value] of Object.entries(query)) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value)) {
      for (const item of value) params = params.append(key, String(item));
    } else {
      params = params.set(key, String(value));
    }
  }
  return params;
}
