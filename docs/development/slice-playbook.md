# Feature slice playbook

How a feature slice is delivered in this repo. Every slice is full-stack: use cases, REST endpoints, MCP tools, Angular pages, tests and docs for one feature area.

## Workflow

1. Work on your own branch `feat/<slice>` (in your own worktree). Never commit to `main`; the orchestrator merges after review.
2. `main` moves while you work. Bring it in with `git fetch && git merge origin/main` (not rebase) whenever you need something that landed there.
3. Commit in logical steps and push your branch.
4. Only touch files that belong to your slice. Shared files you may need to touch (keep the diff minimal and mention it in your report): `web/src/app/app.routes.ts`, shared UI kit components (`web/src/app/shared/**`) when you need a genuinely reusable addition.
5. Schema: the whole model already exists in `InitialCreate`. If you must change it, regenerate `InitialCreate` (ADR 0006) and say so in your report.

## Read first

* [Spec](../product/01-refined-spec.md) — normative. Your slice's sections are named in your brief.
* [Decisions](../decisions.md) — D-42..D-46 override the spec where they differ.
* [API conventions](../architecture/api-conventions.md), [overview](../architecture/overview.md).
* [Backend guide](backend.md) — the reference slice (`Projects/*`) is the template to copy: handler, endpoint module, MCP tool class, integration tests, leak-guard test.
* [Frontend guide](frontend.md) — view registry (store + view), UI kit, data-testid conventions.
* [Design](../design/) — `design-system.md`, `layout-and-screens.md` and the HTML mockups are the visual bar.

## Quality bar

* **Backend** — every use case has integration tests (Testcontainers) covering the happy path, validation, permissions (owner/member/viewer/outsider, public vs private) and private-project leak paths (spec §10). Domain rules get unit tests.
* **MCP** — every use case of the slice listed in spec §9.3 gets its MCP tool calling the same handler, with at least one integration test per tool through the MCP client helper. Tool descriptions list allowed enum values.
* **Frontend** — pages follow the store + view split and are registered in the view registry. Lists use skeletons, never spinners. Optimistic updates with rollback for inline edits and drag and drop. Keyboard shortcuts from spec §10 where they apply. Vitest tests for non-trivial logic (stores, mappers, validators).
* **E2E** — add Playwright specs under `e2e/tests/<slice>/` for the slice's main user journeys (seed via the API helper, not the UI, except for the journey under test).
* **Look and feel** — check every page in the browser in light and dark themes against the mockups; take screenshots. It must look professional and feel instant.
* **Performance** — `AsNoTracking` projections, no N+1, paging, indexes exist for your queries (check `EXPLAIN` for heavy ones). Lazy routes, `@defer` for heavy widgets, virtual scroll for long lists.
* **Style** — minimal comments (only TODO/FIXME, Arrange/Act/Assert in tests, `///` on public abstractions). No heredocs in shell. Don't prefix `dotnet test` with `rtk` (it runs zero tests).

## Docs

Update in the same branch: `docs/domain/workflows.md` and `docs/glossary.md` if your slice refines a workflow or term; add a decision (`D-xx`, next free number — check `main`) to `docs/decisions.md` for any non-trivial choice you made; add deferred ideas to `docs/ideas.md`.

## Definition of done

`dotnet build` warning-free, `dotnet test` green, `npm run build` within budgets, `npm test` and `npm run lint` green, your Playwright specs green against `docker compose up --build`, branch pushed.

## Report (reply to the orchestrator, ≤25 lines)

What was built; spec items deliberately skipped or changed and why; shared files touched; schema changes; test counts; screenshots taken (paths); known gaps.
