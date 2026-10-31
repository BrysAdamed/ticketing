# 8. A/B-ready views: view registry, store + view split

- Status: Accepted
- Date: 2026-10-26

## Context

The brief: "when developing views, make sure that they will in a future support some A/B testing. For now do not make any multiple views." D-14 and [spec §6.13](../product/01-refined-spec.md#613-feature-flags-and-view-variants) turn this into a contract: every routed page resolves through a view registry keyed by view id, each view has one `default` variant in v1, and no page imports another page's component. Retrofitting this after 40 pages exist would touch every route and every page.

## Decision

- **View registry** (`web/src/app/core/views/`). A typed map from view id (for example `ticket-detail`, `board`, `backlog`) to:
  - an optional flag key;
  - variants: `{ default: () => import(...) }`, each a lazy component loader.
- **Routing.** Routes do not reference page components. Each route names a view id and loads a `ViewHost` component, which reads the current flags signal ([ADR 0007](0007-feature-flags.md)), picks the component registered for the flag's variant, falls back to `default` when the variant is unknown, and renders it with `NgComponentOutlet`.
- **Page = store + view.**
  - The **store** is an `@Injectable()` provided at route level. It holds the page's state as signals, calls the API, and exposes commands (`load`, `save`, `move`, ...). It has no template.
  - The **view** is a presentational standalone component. It injects the store, reads signals and calls commands. It does no HTTP and holds only local UI state (open panels, focus).
  - A future variant is a second view component over the same store, so data loading, optimistic updates and error handling are written once.
- **Exposure hook.** When `ViewHost` renders a view that names a flag, it calls `ViewExposureTracker.exposed({ viewId, flagKey, variant })`. The v1 implementation does nothing outside development, where it logs. Experiment analytics will replace it without touching pages.
- **Only `default` variants ship in v1.** No second variant is built.
- An ESLint `no-restricted-imports` rule forbids importing from another feature's `pages/` folder.

## Consequences

- Adding an A/B test later is: declare a flag in the catalog (D-169), write one view component, register it. No route or store changes.
- Every page costs one extra file (the store) and a registry entry. The split also makes stores easy to unit test without rendering ([ADR 0011](0011-testing-strategy.md)).
- Variants of one page must share the store's state shape. A variant that needs different data extends the store rather than forking it.
- Route-level code splitting still works because each variant is a lazy import.
- Exposure events only mean something once a view has a second variant and an experiment runs; until then the hook is a seam, not a feature.

## Alternatives considered

- **`@if (flag)` inside page templates.** Works for small toggles, but whole-page experiments would bloat one component with two layouts.
- **Router-level `canMatch` guards with duplicate routes per variant.** Angular supports it, but variant logic would spread across route files and could not fall back cleanly.
- **Build nothing now.** The brief asks for readiness; the indirection is cheap now and expensive later (D-14).
