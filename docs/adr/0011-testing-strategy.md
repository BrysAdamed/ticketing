# 11. Testing strategy

- Status: Accepted
- Date: 2026-10-26

## Context

The spec is normative: every "must" needs a test ([spec preamble](../product/01-refined-spec.md)). The brief requires integration tests with Testcontainers and Playwright e2e tests. Much of the behaviour depends on PostgreSQL itself: `xmin` concurrency, `UPDATE ... RETURNING` counters, `COLLATE "C"` ordering, `text[]` and `jsonb`, full text and trigram search, partial unique indexes. The security requirement says every path where private-project data could leak must be tested ([spec §10](../product/01-refined-spec.md#10-non-functional-requirements)).

## Decision

**Backend unit tests: `tests/Ticketing.Domain.Tests`** (xUnit v3 4.x on Microsoft Testing Platform; `global.json` sets `"test": { "runner": "Microsoft.Testing.Platform" }`, research R5).

- Pure domain rules with no I/O: status side effects, resolution rules, parent depth and cycle checks, label normalization, key parsing, password policy, PAT format and hashing, `FractionalIndex` (including the npm parity fixture), the flag bucket function (shared fixture with the frontend), regression summary math, bug description template.

**Integration tests: `tests/Ticketing.IntegrationTests`.**

- `WebApplicationFactory<Program>` hosting the real API against **PostgreSQL 18 in Testcontainers**. The schema is created with `MigrateAsync()` ([ADR 0006](0006-schema-migration-policy.md)).
- **Respawn** resets data before each test (via xUnit v3's test lifecycle hook on the collection fixture). Tests in one collection run sequentially; parallelism later means one database per collection.
- No EF Core in-memory provider and no SQLite: they do not behave like PostgreSQL for any of the features listed above.
- Tests go through HTTP: mostly with a seeded PAT (no XSRF needed), plus explicit tests of the cookie + XSRF path ([ADR 0003](0003-authentication-cookie-and-pat.md)).
- What belongs here: every endpoint's happy path and its spec error codes, the permission matrix of [spec §5](../product/01-refined-spec.md#5-permissions), one test per private-data leak path (search, boards, links, hints, dashboards, MCP), concurrency (`409`, parallel ticket creation), regression session flows, board archive carry-over, rank rebalancing, migrations.
- MCP: a contract test lists tools and annotations against [spec §9.3](../product/01-refined-spec.md#93-tools) for both token scopes, and a few calls run end to end over `/mcp`. Rules are not re-tested through MCP because both transports share handlers ([ADR 0002](0002-modular-monolith-and-layering.md)).

**Frontend unit tests: Vitest** (Angular CLI default runner, jsdom).

- Only for logic-heavy code: signal stores (optimistic update and rollback, `409` handling), the view registry and fallback, flag evaluation helpers and the bucket fixture, `MarkdownPipe` (escaping, key links, XSS payloads), filter-to-URL serialization, keyboard shortcut handling.
- No snapshot tests and no tests that only assert a template renders.

**End-to-end: Playwright** in a separate `e2e/` npm package.

- Runs against the real stack from `docker compose` (nginx + API + PostgreSQL), so routing, cookies, XSRF and the SPA build are exercised.
- Login runs once in a setup project and saves storage state. Test data is seeded through the REST API with a PAT. Each test uses unique project keys, so tests run in parallel without database resets.
- Scope: the critical journeys only. Sign in, create and edit a ticket, backlog ↔ board drag and drop, board archive with carry-over, test case to regression session to failed item to bug, PAT creation, flag toggling, quick jump. Plus an accessibility smoke check on main pages.

**Where a new test goes:** a rule that needs no database → domain unit test. Anything touching persistence, permissions, HTTP contracts or MCP → integration test. Client-side logic with branches → Vitest. A user journey across pages → Playwright, only if it is a critical path.

## Consequences

- Integration tests need Docker (Rancher Desktop in dockerd mode on developer machines). The suite starts one container per run (about 15 s overhead).
- Tests catch PostgreSQL-specific bugs before production, at the cost of a slower suite than an in-memory one.
- The e2e suite stays small, which keeps it fast and stable; most coverage lives in integration tests.
- Shared fixtures (rank parity, flag buckets) tie the C# and TypeScript implementations together; changing one without the other fails CI.

## Alternatives considered

- **EF Core in-memory provider or SQLite for integration tests.** Faster, but skips the database features we rely on; tests would pass on bugs.
- **Mocked repositories in handler unit tests.** Tests the mocks more than the code; integration tests through HTTP cover handlers with real behaviour.
- **Dropping and recreating the database per test.** Simpler isolation, but seconds per test. Respawn deletes rows in milliseconds.
- **Karma/Jasmine for Angular.** No longer the CLI default; Vitest is faster and works with zoneless tests.
- **Large e2e suites covering every rule.** Slow and flaky; the permission matrix is cheaper and more precise at the integration level.
