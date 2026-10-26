# 9. Frontend: Angular 22 with Angular Material, Tabler icons, Chart.js and marked

- Status: Accepted
- Date: 2026-10-26

## Context

The brief requires Angular and says the app must look professional and feel fast. The spec sets an initial bundle under 500 KB gzipped, a board of 500 cards rendered in under 1 s, optimistic drag and drop, keyboard access and WCAG 2.1 AA contrast ([spec §10](../product/01-refined-spec.md#10-non-functional-requirements)). Markdown is CommonMark + GFM with raw HTML not rendered ([spec §2](../product/01-refined-spec.md#2-cross-cutting-conventions)). The original plan was Angular + PrimeNG.

The research found that **PrimeNG 22 is no longer open source**: `primeng@22.x` and its theme and icon packages ship under the commercial PrimeUI License, the free tier does not cover a company of Adamed's size, and the MIT-licensed PrimeNG 21 only supports Angular 21 ([tech-stack.md](../research/tech-stack.md), red flag R1). The owner decided on 2026-10-26: no PrimeNG.

## Decision

- **Angular 22.2** (CLI 22.2.4) on Node 24 LTS, TypeScript `~6.0` (not 7, research R2 and R3).
  - Standalone components only, **zoneless** change detection, **signals** for all state, `OnPush` semantics, the new control flow.
  - Feature folders under `src/app/features/<feature>` with lazy route trees; `core` and `shared` as in the [architecture overview](../architecture/overview.md). Pages follow [ADR 0008](0008-ab-ready-views.md).
- **UI components: Angular Material 22 + CDK 22** (MIT, released in lockstep with Angular).
  - Themed through the M3 system tokens (`mat.theme`, `mat.theme-overrides`, `--mat-sys-*`) mapped from our own design tokens in [docs/design/tokens.scss](../design/tokens.scss), not per-component CSS overrides. Light by default, dark through the same tokens.
  - CDK drag-drop for the backlog and the board; CDK virtual scroll for long lists; `mat-table` for tables; `mat-autocomplete` + chips for labels and version hints.
  - Dates through `@angular/material-date-fns-adapter` + `date-fns`.
- **Icons: Tabler via `@ng-icons/core` + `@ng-icons/tabler-icons`** (MIT). SVG, tree-shaken per icon. `mat-icon` and Material Symbols (a large icon font) are not used.
- **Charts: Chart.js 4 via `ng2-charts`** (MIT). Only the needed controllers are registered; the dashboard route is lazy. Colours come from the `--mat-sys-*` variables so charts follow the theme.
- **Markdown: `marked` + `DOMPurify`** behind one `MarkdownPipe` in `shared`. `marked` runs with GFM, its `html` tokens are rendered as escaped text (raw HTML is not rendered), an extension links ticket keys matching `\b[A-Z][A-Z0-9]{1,9}-\d+\b`, and DOMPurify sanitizes the output before it is bound with `[innerHTML]`.
- **CI license check** over production npm dependencies, allowing only permissive licenses, so a future relicense like PrimeNG's fails the build.

## Consequences

- No license keys, no vendor relicensing risk; `ng update` upgrades Angular, Material and CDK together.
- Material is leaner than PrimeNG: we build a few components ourselves (kanban card, ticket row, markdown editor with preview, status and priority badges). The design system in `docs/design/` defines them on top of Material tokens.
- Material's look must be pushed toward our design through tokens; anything we cannot express as tokens becomes a small custom component, not a `::ng-deep` override.
- Chart.js measured at 63 KB gzip for line + bar + tooltip + legend versus 190 KB for ECharts, which keeps the dashboard chunk small.
- Escaping raw HTML deviates from `marked` defaults and must be covered by unit tests (including XSS payloads).
- AdaCon and AdaConExt (Angular 21 + PrimeNG 21) will face the same licensing problem when they move to Angular 22.

## Alternatives considered

- **PrimeNG 22.** Commercial license and a license-key banner; rejected (research R1).
- **PrimeNG 21 (MIT).** Pins the app to Angular 21, whose LTS ends 2027-06. A dead end for a new app.
- **Other component kits (Taiga UI, ng-zorro, Spartan).** Viable, but none match Material's maintenance guarantee and lockstep releases. Material + CDK is the lowest long-term risk.
- **ECharts.** Three times larger for chart types a tracker does not need.
- **`ngx-markdown`.** Works, but adds configuration surface (KaTeX, Mermaid, Prism) we do not use and hides the renderer hooks we need for key links and HTML escaping.
- **Zone.js change detection.** Default in older apps; zoneless is the Angular 22 default and avoids change-detection overhead on large boards.
