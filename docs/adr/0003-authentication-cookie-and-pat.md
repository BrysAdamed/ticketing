# 3. Authentication: cookie session for the SPA, personal access tokens for REST and MCP

- Status: Accepted
- Date: 2026-10-26

## Context

v1 uses local accounts managed by an Admin; SSO is later (D-01, I-34). Two kinds of client exist:

- the Angular SPA in a browser, served from the same origin as the API behind nginx ([architecture overview](../architecture/overview.md));
- scripts and LLM clients (Claude Code) calling REST or MCP with a long-lived secret ([spec §4.2](../product/01-refined-spec.md#42-personalaccesstoken), [§6.12](../product/01-refined-spec.md#612-pat-lifecycle), D-37).

Minimal APIs do not validate antiforgery tokens for JSON endpoints ([tech-stack.md](../research/tech-stack.md), red flag R6), so CSRF protection must be added explicitly.

## Decision

**Scheme selection.** The default authentication scheme is a policy scheme. A request with an `Authorization: Bearer ...` header is forwarded to the PAT scheme; every other request goes to the cookie scheme. Business code reads only `ICurrentUser` (id, global role, channel, PAT scope) and never knows which scheme ran.

**Cookie session (SPA).**

- Login with email + password, verified with ASP.NET Core `PasswordHasher<T>` (PBKDF2, no Identity stores). Password policy, lockout and set-password links follow [spec §6.14](../product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01).
- Cookie `tkt_session`: `HttpOnly`, `Secure`, `SameSite=Lax`, 12 hour sliding expiry. Unauthenticated API calls get `401`, never a redirect.
- The principal is re-validated against the user row at most once per minute, so deactivation ends existing web sessions quickly.
- **XSRF:** the server issues an antiforgery request token in the JS-readable cookie `XSRF-TOKEN` on `GET /api/v1/auth/me` (called at SPA bootstrap) and again after login and logout, because the token is bound to the identity. Angular `HttpClient` sends it back as `X-XSRF-TOKEN` on same-origin non-GET requests with no configuration. An endpoint filter on the `/api` group validates it for every unsafe method (POST, PUT, PATCH, DELETE) on a request not authenticated by a PAT, which covers cookie-authenticated writes and the anonymous login and set-password calls. Failure returns `400`.

**Personal access tokens (REST and MCP).**

- Format `tkt_` + 40 random base62 characters (238 bits). Only the SHA-256 hex hash is stored, with a unique index; a fast hash is right because the secret is high-entropy and is looked up on every request. `Prefix` (`tkt_` + 8 characters) is stored for display. The `tkt_` prefix lets secret scanners find leaked tokens.
- A token authenticates only if its hash matches, it is not revoked, `ExpiresAt` is in the future and its user is active. Failures return `401` with `WWW-Authenticate: Bearer` and no hint whether the token exists. `LastUsedAt` is written at most once per 5 minutes.
- Claims carry the user id, global role, token id and scope (`ReadOnly` or `ReadWrite`).
- Authorization policies: `Write` requires a cookie principal or a `ReadWrite` PAT (REST writes and MCP write tools). `CookieOnly` guards PAT management, password change, user administration and feature flag administration ([spec §5.5](../product/01-refined-spec.md#55-pat-scope)); a PAT there gets `403`.
- Rate limit: 600 requests per minute per token, `429` with `Retry-After` (ASP.NET Core rate limiter partitioned by token id).
- Channel: cookie → `Web`; PAT on `/mcp` → `Mcp`; PAT elsewhere → `Api`.

**OIDC later.** OIDC will be added as another scheme behind the same policy scheme, producing the same claims. Handlers and permission code do not change.

## Consequences

- The SPA never handles a secret; a stolen PAT is limited by scope, expiry and revocation.
- Cookie-authenticated writes need the XSRF header, so tests that use the cookie must fetch `/auth/me` first. Most integration and e2e seeding uses a PAT and skips XSRF. A few tests cover the cookie + XSRF path explicitly.
- `SameSite=Lax` keeps the session on top-level navigations from other sites (a ticket link pasted in chat opens signed in). Lax still blocks the cookie on cross-site POSTs; the XSRF token is the main CSRF defence.
- The cookie re-validation adds one cached user lookup per minute per session.

## Alternatives considered

- **JWT bearer tokens for the SPA.** Needs token storage in JavaScript (XSS exposure) or a refresh-token dance; no benefit for a same-origin app.
- **`SameSite=Strict`** (used in the research prototype). Stronger, but drops the cookie on the first request of a cross-site link. The spec ([§6.14](../product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)) chose Lax plus antiforgery.
- **PBKDF2 or bcrypt for PATs.** Slow hashes cannot be looked up by value, so every request would scan candidate tokens. Unnecessary for 238-bit random secrets.
- **OIDC in v1.** Deferred by the product owner (D-01).
