# Ticketing — guide for coding agents

In-house Jira replacement: .NET 10 API (+ in-process MCP server) · Angular 22 SPA · PostgreSQL 18 · docker compose.

## Every change has a ticket

We track this project in Ticketing itself: project `TKT` on the team's own instance (http://localhost:8090), reachable through the `ticketing` MCP server.

1. Before starting, find the ticket (`search_tickets` / `get_ticket`) or create one (`create_ticket`, type and description stating the why). Small fixes get a `Technical` or `Bug` ticket too.
2. Name the branch `<type>/TKT-<n>-<slug>` and start every commit message with the key (`TKT-12: …`).
3. Keep the status current over MCP: `InProgress` when you start, `Review` when the branch is pushed, `Done` when it is merged to `main`. Add test cases (`create_test_case`) for behaviour worth regression-testing.
4. On merge, add a short comment to the ticket: what changed, the merge commit, anything deferred (deferred work = a new ticket, not a TODO).

The instance runs as compose project `ticketing-dogfood` (`TICKETING_PUBLIC_URL=http://localhost:8090 WEB_HOST_PORT=8090 docker compose -p ticketing-dogfood -f docker-compose.yml up -d --build` to upgrade; without the public URL, Delegate to agent is disabled). It holds real data: **never** run `down -v`, demo seeding or e2e suites against it — tests use their own compose project and ports.

## Before you change anything

- The product spec is normative: `docs/product/01-refined-spec.md`. Decisions that override or refine it: `docs/decisions.md` (D-xx). Check both before changing behaviour.
- Feature work follows `docs/development/slice-playbook.md` (quality bar, definition of done).
- Backend how-to: `docs/development/backend.md`. Frontend how-to: `docs/development/frontend.md`. Architecture: `docs/architecture/`, ADRs: `docs/adr/`.
- Domain vocabulary: `docs/glossary.md`. Workflows with diagrams: `docs/domain/workflows.md`. Deferred ideas: `docs/ideas.md`.

## Commands

```bash
dotnet build                                   # warnings are errors
dotnet test                                    # unit + integration (Testcontainers; needs Docker)
cd web && npm test && npm run lint && npm run format:check && npm run build
cp .env.example .env && docker compose up --build   # full stack on http://localhost:8080
cd e2e && npm run typecheck && npx playwright test   # against the running stack
```

- Never prefix `dotnet test` with `rtk` — it makes the run report zero tests.
- The 50k-ticket performance tests are slow; skip them locally with `dotnet test -- --filter-not-trait "Category=Performance"`.

## Rules that keep the codebase coherent

- **One use case = one handler** in `src/Ticketing.Application/<Feature>/<UseCase>.cs`. The REST endpoint (`Api/Endpoints/<Feature>Endpoints.cs`, an `IEndpointModule`) and the MCP tool (`Api/Mcp/<Feature>Tools.cs`) both call that handler and contain no business logic. Endpoints and tools are discovered by scanning — no shared registration file.
- **Authorization lives in handlers** via `IProjectAccess` (`EnsureCanRead/Write/Owner`). Every query over project data is composed with `ReadableProjects()`; private projects return 404, never 403. Copy `tests/Ticketing.IntegrationTests/Projects/ReadableProjectsLeakGuardTests.cs` when adding a read path.
- **Errors** are domain/app exceptions with stable codes (`ticket.parent.cycle`) declared in `src/Ticketing.Domain/<Feature>/<Feature>Errors.cs`; they become RFC 9457 problem details and MCP `{code,message,hint}`.
- **Ordering** goes through `ITicketRanker` inside `db.InTransactionAsync` — never write `rank` by hand.
- **Schema**: v1 has shipped, so `InitialCreate` is frozen. Every schema change is a new, additive migration; never edit or regenerate a merged one (ADR 0006, backend.md). On a snapshot merge conflict, drop your own migration, merge `main`, re-add it.
- **Frontend**: features live in `web/src/app/features/<name>/` and may not import each other; shared clients go in `core/`, reusable UI in `shared/`. Every routed page is a store + view pair registered through the view registry (`defineView` / `viewRoute`) so A/B variants can be added later (ADR 0008). Other features extend the ticket view via `provideTicketDetailSection`, never by editing it.
- **UI quality**: match `docs/design/` (design system, mockups); design tokens live in `web/src/styles/_tokens.scss`. Skeletons instead of spinners, optimistic updates with rollback, keyboard shortcuts registered via `ShortcutService`, light and dark theme both checked.
- **Achievements**: consider achievements in every new epic and feature: plan a catalogue entry (or a linked ticket for one) for real actions worth one, or say in the ticket that none fits (slice-playbook.md definition of done, backend.md "Designing an achievement").
- **Tests**: integration tests for every use case including permission and leak paths; Vitest for non-trivial frontend logic; Playwright specs seed data through the API helper, never the UI.

## Style

- Minimal comments: only `TODO`/`FIXME`, `// Arrange` / `// Act` / `// Assert` in tests, and `///` docs on public abstractions.
- Match the surrounding code; prefer simple, explicit code over cleverness.
- Record non-trivial choices as a new `D-xx` in `docs/decisions.md` (next free number) and deferred work in `docs/ideas.md`.

## Using the app from an LLM

The app exposes an MCP server at `/mcp` authenticated with a personal access token — see `docs/mcp.md`.
