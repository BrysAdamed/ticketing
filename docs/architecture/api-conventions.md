# REST API conventions

Normative for backend and frontend. The product rules behind them are in [the spec](../product/01-refined-spec.md) §2 and §8.

## Basics

* Base path `/api/v1`. JSON with camelCase property names. Enums travel as their PascalCase names (`ReadyForTesting`).
* Timestamps are ISO 8601 UTC strings (`2026-10-26T12:00:00Z`).
* Ids are UUID strings. Every route that names a project, ticket, test case or regression session accepts either the id or the human key (`/api/v1/projects/WEB`, `/api/v1/tickets/WEB-42`).
* OpenAPI document: `/api/v1/openapi.json`; Scalar UI at `/scalar` (non-production or Admin only).

## Authentication

| Client | Mechanism |
| --- | --- |
| Angular SPA | Cookie session `tkt_session` (HttpOnly, Secure, SameSite=Lax, 12 h sliding). |
| Scripts / LLMs | `Authorization: Bearer tkt_…` (personal access token). |

### CSRF

Cookie-authenticated unsafe requests (`POST`, `PUT`, `PATCH`, `DELETE`) must send header `X-XSRF-TOKEN` equal to the value of the readable cookie `XSRF-TOKEN`. Angular's `HttpClient` does this automatically (`withXsrfConfiguration` defaults). PAT-authenticated requests are exempt. The server re-issues `XSRF-TOKEN` after login and logout.

### Auth endpoints (implemented in the foundation)

| Method & path | Body | Success | Errors |
| --- | --- | --- | --- |
| `GET /api/v1/auth/csrf` | – | `204`, sets `XSRF-TOKEN` cookie | – |
| `POST /api/v1/auth/login` | `{ email, password }` | `200 CurrentUser`, sets session + new XSRF cookie | `401 auth.invalidCredentials`, `423 auth.lockedOut` |
| `POST /api/v1/auth/logout` | – | `204` | – |
| `GET /api/v1/me` | – | `200 CurrentUser` | `401` |
| `GET /api/v1/me/flags` | – | `200 { "flags": { "<key>": "on" \| "off" } }` | `401` |
| `POST /api/v1/auth/set-password/inspect` | `{ token }` | `200 { email, displayName, isNewUser, expiresAt }` | `404 user.setPasswordToken.invalid` |
| `POST /api/v1/auth/set-password` | `{ token, password }` | `204`, ends the user's sessions | `400 user.password.*`, `404 user.setPasswordToken.invalid` |
| `PATCH /api/v1/me` | `{ displayName }` | `200 CurrentUser` (cookie only) | `400`, `403 auth.cookieSessionRequired` |
| `POST /api/v1/me/password` | `{ currentPassword, newPassword }` | `204`, re-issues this session, ends the others (cookie only) | `400 user.password.*` |

User administration (`/admin/users`), tokens (`/me/tokens`, `/admin/tokens`), flags (`/admin/flags`) and the audit trail (`/admin/audit`) are documented in the OpenAPI document; all of them accept only the cookie session.

```jsonc
// CurrentUser
{ "id": "…", "email": "jane@example.com", "displayName": "Jane Doe", "globalRole": "Admin" }
```

The SPA calls `GET /api/v1/auth/csrf` once at startup, then `GET /api/v1/me`; a `401` routes to `/login?returnUrl=…`.

## Errors

RFC 9457 problem details, always with a stable machine `code`:

```json
{
  "type": "https://ticketing/errors/ticket.parent.cycle",
  "title": "Setting this parent would create a cycle.",
  "status": 409,
  "code": "ticket.parent.cycle",
  "errors": { "parentKey": ["WEB-9 is a descendant of WEB-4."] },
  "traceId": "…"
}
```

| Status | When |
| --- | --- |
| 400 | Validation (`code: "validation"`, per-field `errors`). |
| 401 | Not authenticated. |
| 403 | Authenticated, can read the resource but may not perform the action. |
| 404 | Not found **or** not readable (private projects never leak existence). |
| 409 | Business-rule conflict or stale `If-Match` (`code: "concurrency.conflict"`). |
| 423 | Account locked. |
| 429 | Rate limited (PATs), with `Retry-After`. |

## Concurrency

Mutable resources expose `rowVersion` (number, PostgreSQL `xmin`). It is named `rowVersion`, not `version`, because tickets and regression sessions have a business field called `version`. GET and PATCH responses also send it as `ETag: "<rowVersion>"`.

Updates (`PATCH`) may send `If-Match: "<rowVersion>"`. It is optional (D-43). When the value is stale, the server answers `409 concurrency.conflict` without the current state, and the client refetches.

PATCH bodies are partial: omitted properties stay unchanged, and `null` clears an optional field.

## Lists

Cursor pagination: `?limit=25&cursor=…` (max 100). Response:

```json
{ "items": [ … ], "nextCursor": "opaque-or-null" }
```

Small bounded collections (enums, members, hints, board columns) are returned as plain arrays without paging.

## Idempotency

Create endpoints accept an optional `Idempotency-Key` header; a repeat within 24 h by the same user returns the original response.

## Write channel

The server derives the activity-log channel itself: cookie session → `Web`, PAT over REST → `Api`, PAT over `/mcp` → `Mcp`. Clients never send it.
