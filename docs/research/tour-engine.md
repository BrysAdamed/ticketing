# Guided tours: home-grown engine on the Angular CDK vs a library (TKT-53, 2026-10-28)

Spike for epic TKT-52. Question: can a small tour engine built on CDK Overlay and CDK A11y meet the accessibility and zoneless requirements, or should we adopt a library? Answer: **build it**. The prototype meets every acceptance criterion in about 870 lines, templates and styles included. The only MIT library that runs on Angular 22 renders and steps correctly under zoneless, but it fails on accessibility and leaks the global shortcuts. The decision is recorded as [D-129](../decisions.md#d-129-guided-tours-home-grown-engine-on-cdk-overlay-and-a11y-tour-anchors-in-every-view-variant-onboarding-owner-decisions-tkt-53).

## 1. Candidates

| Library | Version (npm, 2026-10-28) | Licence | Verdict |
|---|---|---|---|
| Shepherd.js | 15.3.0 | AGPL-3.0 | Excluded: licence. |
| intro.js | 8.6.0 | AGPL-3.0 | Excluded: licence. |
| driver.js | 1.10.2 | MIT | Rejected: its `.driver-overlay` is not a `.cdk-overlay-backdrop`, so `ShortcutService.isOverlayOpen()` lets `c`, `g b` and `/` fire during a tour. No focus trap and no dialog ARIA. |
| ngx-ui-tour-md-menu (+ ngx-ui-tour-core) | 17.0.0 (2026-06-26) | MIT | Tested under zoneless (section 3). Works, but fails the accessibility criteria. |
| Home-grown on `@angular/cdk` 22.2 | n/a | MIT (CDK) | Prototype built (section 2). Meets every criterion. |

## 2. The prototype

Code: `web/src/app/core/onboarding/engine/`. This is the seed TKT-56 builds on, not throwaway code. The demo was in the UI kit (`/dev/ui-kit`, section "Guided tour engine"; TKT-56 removed it in favour of the real backlog tour, D-134):
- **Tour the KEY backlog** starts a three-step tour from the UI kit. It navigates to `/projects/KEY/backlog` (cross-route `route` steps) and spotlights the **New ticket** button.
- **Tour this page** runs a tour on the UI kit itself, with a missing anchor (skipped), an `admin` step and focus return.

Tour data for the demo is in `features/ui-kit/tour-prototype.ts`. The real backlog tour belongs to TKT-56 (`core/onboarding/tours/`).

| File | What it does | Bundle |
|---|---|---|
| `tour.model.ts` | `TourDefinition`, `TourStep`, `TourAccess`. Pure data, no Angular imports. | types only |
| `tour-logic.ts` | Pure rules: role filter, `:param` routes, path match, skip and abort plan, spotlight hole geometry. | lazy |
| `tour-anchor.registry.ts` | `TourAnchorRegistry`, a root service: signal list of `{ id, element }`, `get`, `has`, `whenAvailable(id, timeout)`. | root, tiny |
| `tour-anchor.directive.ts` | `tkTourAnchor="backlog.quick-create"`: renders `data-tour`, registers while in the DOM. | in feature chunks |
| `tour-launcher.ts` | `TourLauncher.start(tour, { access, params, returnFocusTo })` resolves `TourResult`. Plans the tour, then `import('./tour-session')`. | root, tiny |
| `tour-session.ts` | One running tour: overlays, measuring, keys, interruptions. | lazy chunk |
| `tour-spotlight.component.ts` | Full-screen SVG with a `<mask>` hole and an accent ring. | lazy chunk |
| `tour-popover.component.ts` | Step card: `role="dialog"`, `aria-modal`, `aria-labelledby`/`aria-describedby`, `cdkTrapFocus`. | lazy chunk |

### 2.1 How each criterion is met

| Criterion | How | Verified |
|---|---|---|
| Spotlight on the backlog's New button, SVG mask in a CDK overlay | Overlay 1: global position strategy, transparent CDK backdrop, `tk-tour-spotlight` (fixed, `pointer-events: none`) draws `rect.dim` filled with `--tk-overlay-mask` through a `<mask>` whose black rounded rect is the hole (padding 4 px, `rx` 8), plus a 2 px `--tk-accent` ring. | Playwright on our own stack: New button (`backlog.quick-create`) at (1284, 56, 136×32), hole at (1280, 52, 144×40). |
| Re-measured with ResizeObserver and on scroll | `ResizeObserver` on the anchor and on `<html>`, plus `resize` on the window and a capturing, passive `scroll` listener on the document (inner scroll containers included). Everything is throttled to one `requestAnimationFrame`. A disconnected anchor (re-render, `@if`) is looked up again through the registry. | Scrolling the UI kit's content by 40 px moved the hole from y 40 to 0 (clipped). Resizing 1440→1000 px changed the hole width from 460 to 410. |
| Popover with `FlexibleConnectedPositionStrategy` | Overlay 2: `createFlexibleConnectedPositionStrategy(injector, anchor)` with the step's `placement` first, then below/above (start and end aligned), end, start. Uses `withPush`, an 8 px viewport margin and a reposition scroll strategy. On a step change, `setOrigin()` + `withPositions()` + `updatePosition()` reuse the same overlay. | Card at x 1100, y 100: below the New button, aligned to its end (the start-aligned position would overflow). |
| `cdkTrapFocus`, `role="dialog"` + `aria-labelledby`, "Step n of m" via `LiveAnnouncer` | Card markup as above; `aria-describedby` points at the body. The dialog takes focus on open (screen readers read title and body). Each step change calls `LiveAnnouncer.announce('Step 2 of 3: Group and sort', 'polite')`. The CDK adds the live region to `aria-owns` of `aria-modal` elements, so VoiceOver still hears it. | Vitest and Playwright: role, `aria-modal`, label text, focus inside, live region text "Step 1 of 3: Create a ticket". |
| Esc, ← and → | `OverlayRef.keydownEvents()` of the popover (the CDK keyboard dispatcher), so keys work wherever focus is. On the last step, → does nothing: Done must be pressed. | Vitest and Playwright. |
| Focus returns to the trigger | `returnFocusTo` (default: the element focused at start) is refocused on `completed`, `dismissed` and `aborted`, but not on `interrupted`: the peek or a dialog keeps its focus. | Vitest (`#trigger`) and Playwright (Done → `tour-demo-here` focused). |
| Global shortcuts suppressed | No `ShortcutService` change. The spotlight overlay has a CDK backdrop, so `isOverlayOpen()` is true for the whole tour, as for any dialog. | Vitest: `c` not fired while open, fired after Esc. Playwright: `c` and `g m` did nothing during the tour; `g m` navigated after Esc. |
| Light and dark themes | Only tokens: `--tk-surface-raised`, `--tk-border`, `--tk-border-subtle`, `--tk-shadow-lg`, `--tk-radius-lg`, `--tk-overlay-mask` (0.32 light / 0.55 dark), `--tk-accent`, `--tk-text-subtle`. | Screenshots `docs/screenshots/tkt-53-tour-step-{light,dark}.png`. |
| `prefers-reduced-motion` | The card's fade + 4 px rise, the spotlight fade and the hole's move use `--tk-duration-*`, which the tokens set to 0 ms. Scrolling the anchor into view uses `behavior: 'auto'` instead of `'smooth'`. | Playwright with `reducedMotion: 'reduce'`: animation duration `0s`. |
| Zoneless | Signals plus `ComponentRef.setInput` and `afterNextRender`. The app and TestBed both run `provideZonelessChangeDetection()`. | All of the above ran zoneless. |
| Initial bundle unchanged | `tour-session` and both components are one lazy chunk (14.4 kB raw). The directive and registry are a 1.2 kB chunk shared by the backlog and UI kit chunks. No tour code is reachable from `main` (checked by walking static imports). Initial total: 949.05 kB before, 949.32 kB after. The +0.27 kB is esbuild export plumbing, because the lazy launcher now imports `NavigationContext` and `PeekService` from the initial chunks. The budget (1 MB warning) is not touched. | `npm run build` on both commits. |

### 2.2 Interruptions

A tour gives way to anything that takes over the screen:
- **Peek opens.** An effect on `PeekService.isOpen()` closes the tour on the false→true transition. `TourLauncher.start` closes an open peek first, because the anchor may sit under it.
- **Another modal overlay opens.** A `MutationObserver` on the CDK overlay container (subtree) watches for a `.cdk-overlay-backdrop` outside the tour's own hosts. Tooltips and toasts have no backdrop, so they don't interrupt.
- **Navigation the tour did not start.** A `NavigationStart` to a different path closes the tour. Query-only changes such as filters do not. The tour's own `route` navigations are flagged and ignored.

All three resolve `interrupted` and leave focus alone. Clicking the dimmed page keeps the tour and puts focus back on the card.

## 3. ngx-ui-tour-md-menu 17.0.0 under zoneless

Installed with `npm install --no-save` (it was never in `package.json` or the lockfile). A temporary component in the UI kit route had `provideUiTour({ enableBackdrop: true })`, two `tourAnchor` elements and `<tour-step-template />`. It ran on the same stack and was driven by Playwright.

| Check | Result |
|---|---|
| Renders and steps under zoneless | **Yes.** The step shows. → moves to step 2 and the progress text updates ("2 / 2"). Esc ends. No console errors. |
| Popover semantics | `role="menu"` (it is a `mat-menu`). No `aria-labelledby`, no `aria-modal`, and the buttons are not menu items. |
| Focus | Focus stays on the start button and never enters the step. Tab walks the page behind the tour. When the tour ends, focus is wherever it was. |
| Announcements | None; the live region stays empty. |
| Backdrop / shortcuts | Four `div.ngx-ui-tour_backdrop` panels, no CDK backdrop, unless `closeOnOutsideClick` gives the menu one, and then a click outside ends the tour. **`g m` navigated to My work while the tour was open.** That ended the tour. |
| Keys | Escape, ← and → are `window:keydown` host listeners, so they fire next to `ShortcutService` instead of replacing it. |
| Look | The default template uses Material Icons ligatures (`close`, `chevron_left`), which render as words because we ship Tabler icons. A custom step template is needed anyway. |
| Peer deps | `@angular/core`, `cdk` and `material` `^22.0.0`, `ngx-ui-tour-core` 17.0.0 (+ `router`, `rxjs`). |

To fix all of that we would write the step template, the focus trap, the ARIA, the announcements and the shortcut suppression ourselves. That is most of the prototype, plus a dependency on a menu-shaped popover. It stays the documented fallback (owner decision 1), but nothing in this spike calls for it.

## 4. Engine design for TKT-56 (and room for TKT-79, TKT-80)

### 4.1 Tour data

Tours are pure data in `core/onboarding/tours/<view>.tours.ts` (no Angular imports, so Playwright specs can import them). Copy is inline, with stable step ids, so moving it to i18n later is mechanical (I-60).

```ts
export const BACKLOG_TOUR: TourDefinition = {
  id: 'tour.backlog.list',     // guide id in user_guide_state (GUIDE_ID_PATTERN, D-130)
  version: 1,                  // raise to show it again
  viewId: 'backlog.list',      // keyed by view id, never by variant (D-129)
  title: 'Backlog',
  steps: [
    { id: 'quick-create', anchor: 'backlog.quick-create', requires: 'write', title: '…', body: '…' },
    { id: 'group-sort', anchor: 'backlog.group-sort', placement: 'below', title: '…', body: '…' },
  ],
};
```

`TourStep` today: `id`, `anchor`, `title`, `body`, `requires?: 'write' | 'owner' | 'admin'`, `placement?: 'below' | 'above' | 'start' | 'end'`, `route?: '/projects/:projectKey/…'`.

Additions planned for TKT-80 (not built in the spike, so nothing half-done ships):

```ts
interface TourStep {
  // …
  /// Advance when the user really does the action, not on Next. Data, not a function, so tours stay importable by e2e.
  advanceWhen?:
    | { kind: 'route'; path: string }                       // '/projects/:projectKey/boards/:boardId'
    | { kind: 'condition'; id: string; params?: Record<string, string> };  // resolved by TOUR_CONDITIONS
  optional?: boolean;           // "Skip this step" (status change in TKT-80)
}
```

- `TOUR_CONDITIONS` is a multi-provider `{ id, holds(params, injector): Signal<boolean> | Promise<boolean> }`, for example `project.exists`, `ticket.onBoard`. The session watches the condition and moves on when it holds. On restart, it starts at the first step whose condition does not hold yet (TKT-80 resume).
- An `advanceWhen` step is **non-modal**: the spotlight overlay is created without a backdrop and with a click-through hole. The hole is already a separate shape, so the overlay needs a transparent `path` with `fill-rule="evenodd"` for hit-testing, because SVG masks do not affect hit-testing. There is no focus trap and no `aria-modal`. The card becomes `role="dialog"` without `aria-modal` (or a `region`) and gets a "Continue" affordance. Shortcuts stay live, because TKT-80 expects `c` to create the ticket, and that is exactly what dropping the backdrop gives.
- Cross-route steps already work (`route` + `TourAnchorRegistry.whenAvailable`, 4 s timeout, then skip with a dev warning). TKT-80 turns "navigation the tour did not start" from `interrupted` into **paused**: dispose the overlays, keep the session, show a "Continue the walkthrough" pill (a small non-modal overlay or a shell slot). `TourResult` gains `paused`, or the launcher exposes `paused()` as a signal.

### 4.2 Starting a tour

- `TourLauncher.start(tour, { access, params, returnFocusTo })` returns `Promise<TourResult>`: `completed`, `dismissed`, `aborted` or `interrupted`. TKT-56 wraps it in a `GuidedTours` service in `core/onboarding/` that:
  - builds `access` from `ProjectContext.canWrite()`/`isOwner()` and `AuthService.isAdmin()`;
  - stores `completed` and `dismissed` with `OnboardingStateService.complete` / `dismiss(tour.id, tour.version)` (TKT-54, D-130), but not `aborted` or `interrupted`, and uses `isSeen(id, version)` to decide whether an entry point shows the tour as new;
  - picks the tour for `NavigationContext.currentViewId()`. That signal does not exist yet: TKT-56 adds it, reading `routeConfig.data[VIEW_ID_DATA_KEY]`, which `viewRoute` already sets, from the deepest activated route. Peek is ignored, because the peek is closed before a tour starts.
- Entry points (TKT-76 Help menu "Tour of this page", `help.tour.*` palette commands, empty states) call `GuidedTours`. A Help-menu item should pass the menu's trigger button as `returnFocusTo`, because the menu item it was started from is gone by then.
- Rules in `planTour`: role filter first, then anchors on the current route. Missing anchors are skipped (dev-mode `console.warn`). If fewer than half of the current route's anchors resolve, or nothing is left, the tour is `aborted` silently. Steps on other routes are checked when reached.

### 4.3 Anchors

- `tkTourAnchor="<view-area>.<thing>"` on the element; the directive renders `data-tour` and registers it in `TourAnchorRegistry`. Anchors are separate from `data-testid`: tests may change test ids freely, tours never look them up. Playwright may use `[data-tour=…]`.
- The registry keeps a list, and the latest registration of an id wins. A peek panel over the board can expose `ticket.*` anchors while the page underneath has its own.
- Ticket view sections added through `provideTicketDetailSection` put `tkTourAnchor` inside their own component (TKT-79).
- **Anchor rule (D-129):** every variant of a view exposes the same tour anchor ids. A variant that drops a feature drops its anchor, and the step is skipped. Anchor ids are part of a view's contract like its view id. Spec 14.4 (TKT-75) names the guard: `e2e/tests/onboarding/tour-anchors.spec.ts` opens every tour's view with seeded data and fails when an anchor disappears, and a Vitest test checks that every tour's view id is registered. When a second variant ever exists, the e2e spec runs once per variant (force the flag).

### 4.4 Shortcuts, overlays, peek

- Modal steps suppress shortcuts through the existing contract: a CDK backdrop is present, so `isOverlayOpen()` is true. Nothing in `ShortcutService` changes, and the `?` sheet needs no special case.
- The popover's keys go through `OverlayRef.keydownEvents()`, not `ShortcutService`, so they cannot clash with page shortcuts (`←`/`→` are not registered globally today).
- The tour closes on peek, on another backdrop overlay, and on navigation it did not start (section 2.2).
- A tour started from the palette starts after the palette has closed: `CommandPaletteComponent` emits `closed` before it runs the item. The palette restores focus to what was focused before it opened, and that element becomes the tour's default `returnFocusTo`.

### 4.5 Lazy loading

`TourLauncher`, `TourAnchorRegistry` and `TourAnchorDirective` are the only eager pieces: a few hundred bytes, in feature chunks or root services. The session, both components, `LiveAnnouncer` use and the positioning code load on the first `start()`. Tour definitions should be imported lazily by `GuidedTours` too (`import('./tours/backlog.tours')`), keyed by view id, so adding tours never grows `main`.

## 5. Look: the TKT-75 mockup, with one deviation

TKT-75's mockup (`docs/design/mockups/onboarding.html`, section "Tour step with spotlight") landed on the integration branch during the spike. The prototype follows it, using only existing tokens:
- Card: 320 px, `--tk-surface-raised`, 1 px `--tk-border`, `--tk-radius-lg`, `--tk-shadow-lg`.
- Eyebrow: "Backlog tour · Step 1 of 3" (`--tk-text-xs`, medium, `--tk-text-subtle`) and an "End tour" × button.
- Title `--tk-text-base` semibold; body `--tk-text-base` in `--tk-text-muted`.
- Progress dots: 6 px dots, the current one 16 px wide in `--tk-accent`. They are hidden from screen readers, because the live region says "Step n of m".
- Actions at 28 px (`tk-dense`): "Skip tour" (text, hidden on the last step), "Back" (stroked, disabled on step 1), "Next →" / "Done" (flat, accent).
- Key row under a `--tk-border-subtle` rule: `←` `→` move, `Esc` end, "Shortcuts paused".
- Spotlight: page dimmed with `--tk-overlay-mask`, hole padded 4 px with an 8 px radius, 2 px `--tk-accent` ring.
- Motion: card fade + 4 px rise over `--tk-duration-fast`, dots and spotlight over `--tk-duration-fast` / `--tk-duration-base`, all 0 under reduced motion.

**Deviation: no caret.** The mockup draws a rotated-square arrow on the card. With `FlexibleConnectedPositionStrategy` and `withPush`, the card can flip sides or shift away from the anchor's centre, so a caret needs `positionChanges` handling and an offset computed from the pushed position. The spotlight ring already marks the target. TKT-56 can add the caret, or TKT-75 can drop it from the mockup. I recommend dropping it.

## 6. MCP server instructions (for TKT-59)

`ModelContextProtocol` 2.3.0 (pinned in `Directory.Packages.props`) exposes `McpServerOptions.ServerInstructions` ("Gets or sets optional server instructions to send to clients", checked in the package's XML docs). Set it in the existing `AddMcpServer(o => …)` call in `src/Ticketing.Api/Mcp/McpSetup.cs`, next to `o.ServerInfo`.

## 7. How this was checked

- Vitest (`core/onboarding/engine/*.spec.ts`, zoneless TestBed): plan rules, geometry, routes. The engine end to end: dialog semantics, announcement, shortcut suppression, arrows, Done, Esc, focus return, interruption by another backdrop overlay and by the peek, and the abort rule.
- Playwright script (not committed) against our own compose stack (`-p tkt53`, port 8153) through `ng serve` on 4253. Seeded demo data, bootstrap Admin, Chromium 1440×900, light and dark, reduced motion.
- `npm run build` on the base and spike commits for the bundle comparison. A static-import walk from `main` checked that no tour code is reachable.
