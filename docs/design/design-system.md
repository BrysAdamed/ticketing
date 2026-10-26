# Design system

Visual language for Ticketing. Target feel: Linear / Height / GitHub Projects. Dense but calm, keyboard-first, crisp type, hairline borders, light and dark themes of equal quality.

Token source of truth: [`tokens.scss`](./tokens.scss). Angular Material + CDK mapping: [`material-theming.md`](./material-theming.md). Screens: [`layout-and-screens.md`](./layout-and-screens.md). Visual reference: [`mockups/`](./mockups/). The mockups are static HTML: they embed `tokens.scss` as CSS, follow `prefers-color-scheme`, and have a Theme button in the sidebar footer. Only the mockups load Inter from Google Fonts, and they fall back to the system stack when offline.

## 1. Principles

1. **Speed is the feature.** Every interaction answers within one frame. Updates are optimistic and roll back on failure. Lists render from cache first and refresh in the background. Routes switch instantly, with no page transitions.
2. **Density with calm.** 32px rows and 13px text, kept calm by whitespace, hairline borders and muted metadata. Color is for meaning only (status, type, priority, errors), never decoration.
3. **Keyboard first, mouse friendly.** Every list and board action has a shortcut. Focus is always visible. `⌘K`/`Ctrl+K` reaches everything.
4. **One way to show a thing.** A status, type or priority looks the same in the backlog, on the board, in a select and in a chart. Use the shared components (`StatusIcon`, `TypeIcon`, `PriorityIcon`, `Badge`, `Avatar`, `LabelChip`) and never restyle them in place.
5. **Edit in place.** Fields are edited where they are shown (inline selects, click-to-edit title). Dialogs are for creation and destructive confirmation only.
6. **Theme parity.** Both themes are designed, not inverted. Components use semantic tokens only, so a component that looks right in light also looks right in dark.
7. **Stable seams for A/B.** Each screen is a named view (`backlog.list`, `ticket.detail`, ...) with a stable input/output contract, so a feature flag can later swap in a variant without touching routing or data.

## 2. Color

Two layers:

- **Primitives**: `--tk-gray-*` (0 to 950), `--tk-iris-*` (brand, 50 to 950), and one solid plus one `-fg` value per hue (`red, orange, amber, green, grass, teal, cyan, blue, violet, pink, gray`). The hue values are redefined in dark mode for luminance.
- **Semantic**: everything components use. Tints (`-bg`, `-border`) are derived with `color-mix()` from the hue at 10%/24% (light) or 16%/32% (dark), so a badge works on any surface.

### Neutral roles

| Token | Light | Dark | Use |
|---|---|---|---|
| `--tk-bg` | `#ffffff` | gray-925 `#151619` | Main canvas |
| `--tk-bg-sidebar` | gray-50 | gray-950 | Sidebar |
| `--tk-bg-subtle` | gray-50 | gray-900 | Group headers, table header, board columns |
| `--tk-surface` | `#ffffff` | gray-900 | Cards, panels |
| `--tk-surface-raised` | `#ffffff` + shadow | gray-850 + shadow | Popovers, menus, dialogs |
| `--tk-bg-hover` / `--tk-bg-active` | ink 4.5% / 8% | white 4.5% / 8% | Row and control hover/press (translucent, works on any surface) |
| `--tk-border-subtle` / `--tk-border` / `--tk-border-strong` | gray-100 / 150 / 200 | gray-850 / 800 / 750 | Row dividers / panels / inputs and emphasis |
| `--tk-text` | gray-900 | `#ececef` | Primary text (contrast at least 15:1) |
| `--tk-text-muted` | gray-600 | gray-400 | Secondary text, keys, metadata (at least 5.5:1) |
| `--tk-text-subtle` | gray-500 | gray-500 | Placeholders, timestamps, disabled-ish hints (at least 3.5:1, never for essential text) |

### Brand / accent

Iris indigo (`--tk-iris-600` `#4f55c9` light, `--tk-iris-500` `#6169db` dark). Used only for the primary button, the current nav item indicator, links, focus rings, selection and the checkbox when checked. There is at most one primary button per view.

| Token | Use |
|---|---|
| `--tk-accent` / `-hover` / `-active` | Primary button background, checked checkbox |
| `--tk-accent-fg` | Links, active tab text |
| `--tk-accent-subtle` / `-subtle-hover` / `-border` | Selected nav item, info callouts |
| `--tk-selection` | Multi-selected rows and cards |
| `--tk-focus` | 2px focus outline |

### Semantic intents

`success` (green), `warning` (amber), `danger` (red), `info` (blue). Each has `--tk-{intent}` (solid), `-fg` (text on tint), `-bg` (tint) and `-border`. Text on a solid is `--tk-text-on-solid` (white), except warning, which uses `--tk-warning-on-solid` (near black).

## 3. Typography

**Font: Inter (variable), self-hosted via the `@fontsource-variable/inter` npm package**, with a system fallback stack.

Why: Inter is designed for UI at 11 to 14px, has tabular figures (`tnum`) for keys, points and counts, and is the face behind the Linear/GitHub-style look the owner asked for. We self-host it instead of loading Google Fonts because it removes a third-party request from the critical path (no DNS/TLS to fonts.gstatic.com), works in air-gapped Docker deployments, avoids sending user IPs to Google (GDPR), and is cached with the app bundle. Load only the `wght` axis (about 100 KB woff2) with `font-display: swap`. The fallback (`Segoe UI Variable`, `-apple-system`) has similar metrics, so the swap causes little layout shift.

Features: `font-feature-settings: "cv05", "cv11", "calt"` globally (cv05 gives `l` a tail, so `PAY-1l1` reads unambiguously; cv11 gives a single-storey `a`). Add `font-variant-numeric: tabular-nums` on keys, counts, story points, dates and table numeric columns.

Mono (`--tk-font-mono`) is a system stack: Cascadia Mono on Windows, SF Mono on macOS. Used for code blocks, tokens, feature flag keys and API snippets. Ticket keys are **not** mono; they use Inter tabular in `--tk-text-muted`.

| Token | Size/line | Weight | Use |
|---|---|---|---|
| `xs` | 11/16 | 500 | Badges, kbd, column counts, uppercase section labels (+0.04em tracking) |
| `sm` | 12/16 | 400 to 500 | Metadata, timestamps, card footer, table header |
| `base` | 13/20 | 400 / 500 | **Default UI text**, rows, inputs, buttons, menus |
| `md` | 14/20 | 400 | Markdown body (description, comments): reading comfort |
| `lg` | 15/22 | 600 | Section titles inside pages and panels |
| `xl` | 18/24 | 600 | Page titles (`-0.015em`) |
| `2xl` | 22/28 | 600 | Ticket title on detail (`-0.015em`) |
| `3xl` | 28/32 | 600 | KPI numbers (tabular) |

Rules: only weights 400/500/600. No italics in UI chrome. No all-caps except `xs` section labels. Truncate single-line titles with an ellipsis and show the full text in a tooltip after 600ms.

## 4. Spacing, radii, shadows

**Spacing**: 4px grid: `--tk-space-1` (4) `-2` (8) `-3` (12) `-4` (16) `-5` (20) `-6` (24) `-8` (32) `-10` `-12` `-16`. `0-5` (2px) and `1-5` (6px) are for icon-to-text gaps only. Page gutter is 24px, panel padding 16px, row horizontal padding 12px, gap between inline row items 8px.

**Radii**: `xs` 3px (checkbox, kbd), `sm` 4px (badges, row hover, type tile), `md` 6px (buttons, inputs, menu items), `lg` 8px (cards, panels, popovers), `xl` 12px (dialogs), `full` (avatars, label chips, toggles).

**Shadows**: borders do the structural work and shadows mark elevation only.
- `xs`: board cards (rest)
- `sm`: sticky headers when scrolled, focused card
- `md`: menus, selects, popovers, toasts, command palette
- `lg`: dialogs, drawer, a card being dragged

In dark mode shadows are deeper. Elevated surfaces also step up one gray (`surface-raised`) and keep a 1px `--tk-border`, because shadows are hard to see on dark backgrounds.

## 5. Motion

Snappy and functional. Nothing animates longer than 150ms, and nothing bounces.

| Token | Value | Use |
|---|---|---|
| `--tk-duration-instant` | 80ms | Hover/press background, color changes, checkbox |
| `--tk-duration-fast` | 120ms | Menus, selects, tooltips, popovers (fade + 4px translate), toasts |
| `--tk-duration-base` | 150ms | Drawer/peek slide, dialog scale 0.98 to 1, CDK drag drop settle |
| `--tk-ease-out` | `cubic-bezier(0.16,1,0.3,1)` | All enter transitions |
| `--tk-ease-in` | `cubic-bezier(0.4,0,1,1)` | Exits (use ~70% of the enter duration) |

Rules:
- Animate only `opacity` and `transform`, never height or width. Collapsing groups toggle instantly.
- Lists do not animate row insertion. A newly created row gets a 600ms `--tk-accent-subtle` background flash so the eye can find it.
- Drag and drop: the lifted card gets `shadow-lg` and `scale(1.02)`, the placeholder is a dashed outline of the same height, and neighbours shift over 150ms.
- `prefers-reduced-motion: reduce` sets every duration to 0 (handled in tokens).
- Skeleton shimmer is the one exception: a 1.4s linear loop, and static under reduced motion.

## 6. Density

| Element | Size |
|---|---|
| List / table row | 32px (`--tk-row-h`), 28px with `data-density="compact"` on `<html>` (user preference) |
| Controls (button, input, select) | 28px default in toolbars and inline; 32px (`-lg`) in forms and dialogs; 24px (`-sm`) inside rows |
| Top bar | 44px |
| Sidebar | 232px, collapses to 48px (icons only); nav item 28px |
| Board column | 272px wide; card padding 10px, 6px gap between cards |
| Peek panel | 640px (resizable 480 to 960px, width remembered) |
| Icon | 16px in rows and controls, 14px in badges and dense metadata |
| Avatar | 20px in rows and cards, 24px in fields and comments, 32px in profile and admin |

Never place more than about 9 data points in a row. At narrower widths, columns drop in this order: updated date, version, test case count, labels, points.

## 7. Iconography

**Tabler Icons** (outline set) via `@ng-icons/core` + `@ng-icons/tabler-icons`, both **MIT**. This matches `docs/research/tech-stack.md`. Material Symbols (Apache 2.0) is not used.

Why: Tabler's 24-grid outline style with adjustable stroke is the calm Linear/GitHub look, while Material Symbols reads as a Google app. It has about 5,000 icons, including every domain glyph we need. Icons are tree-shaken per icon as inline SVG, so there is no icon font to download. Inside Material components, project `<ng-icon>` as content; no `mat-icon` font is registered. See [`material-theming.md`](./material-theming.md) §6.

Usage: `size="16"`, `strokeWidth="1.75"` (1.5 at 20px and above), color `currentColor`. Icon-only buttons need an `aria-label` and a tooltip that includes the shortcut. The mockups draw their glyphs as inline SVG stand-ins with the same metaphors. Implement each with the Tabler name listed below. The status ring and priority bars are our own SVG components, not icon-set glyphs.

## 8. Domain visual language

The mockups contain the SVG for each glyph below in the `<symbol>` sprite at the top of each mockup. The status ring and priority bars there are exact; the other glyphs are stand-ins for the listed Tabler icons.

### Ticket types: colored glyph, no tile

| Type | Tabler icon | Token | Hue |
|---|---|---|---|
| Epic | `tablerBolt` | `--tk-type-epic` | violet |
| Spike | `tablerFlask` | `--tk-type-spike` | orange |
| User Story | `tablerBookmark` | `--tk-type-userstory` | green |
| Technical | `tablerTool` | `--tk-type-technical` | blue |
| Bug | `tablerBug` | `--tk-type-bug` | red |

At 16px the glyph is stroked in the type color. In the type select and the ticket detail header it sits next to the type name.

### Statuses: progress ring

One `StatusIcon` component: a 14px circle whose filled fraction shows pipeline progress, stroked and filled in the status color. Shape and color both carry meaning, so the icon works for color-blind users and in grayscale.

| Status | Category | Glyph | Token | Hue |
|---|---|---|---|---|
| To Do | todo | empty circle | `--tk-status-todo` | gray |
| In Progress | in progress | ¼ pie | `--tk-status-inprogress` | blue |
| On Hold | in progress | circle with pause bars | `--tk-status-onhold` | amber |
| Review | in progress | ½ pie | `--tk-status-review` | violet |
| Ready for Testing | in progress | ⅝ pie | `--tk-status-readyfortesting` | cyan |
| Testing | in progress | ¾ pie | `--tk-status-testing` | teal |
| Ready for Deploy | in progress | ⅞ pie | `--tk-status-readyfordeploy` | grass |
| Done | done | filled circle with check | `--tk-status-done` | green |

Categories (`--tk-category-todo/inprogress/done`: gray / blue / green) drive dashboard rollups, backlog grouping order and the project progress bar. On Hold counts as *in progress* because work has started. This mapping is a design assumption, so confirm it against the domain glossary. Done tickets in lists show their title in `--tk-text-muted`, not struck through.

### Priority: signal bars

| Priority | Glyph | Color |
|---|---|---|
| Highest | 14px filled rounded square with `!` | `--tk-priority-highest` (red) |
| High | 3 of 3 bars | `--tk-priority-high` (orange) |
| Medium | 2 of 3 bars | `--tk-priority-bar` (text-muted); off bars use `--tk-priority-bar-off` |
| Low | 1 of 3 bars | `--tk-priority-bar` |
| Lowest | 0 of 3 bars (all off) | `--tk-priority-bar-off` |

Priority is the first column in rows. Bars are icon-only and have a tooltip/aria-label such as "Priority: High".

### Severity: text badge (only when set)

| Severity | Style |
|---|---|
| Critical | Solid red, white text |
| Major | Red tint, `--tk-red-fg` text |
| Minor | Amber tint, `--tk-amber-fg` text |
| Trivial | Gray tint, `--tk-gray-fg` text |

Badge anatomy (shared by every badge): height 20px, padding 0 6px, radius `sm`, text `xs` 500, optional 6px leading dot or 12px icon, no border (tint only). In rows it sits after the title, and only when severity is Critical or Major, to keep the list calm.

### Test case status (badge, icon + text)

| Status | Icon | Hue |
|---|---|---|
| New | `tablerCircleDashed` | blue |
| Manual | `tablerHandStop` | violet |
| Automatic | `tablerRobot` | teal |

### Regression item status (badge, icon + text)

| Status | Icon | Hue | Note |
|---|---|---|---|
| Waiting for execution | `tablerCircle` (hollow) | gray | Initial for manual cases |
| Passed | `tablerCircleCheck` | green | Automatic cases start here |
| Failed | `tablerCircleX` | red | Offers "Create bug" |
| Blocked | `tablerBan` | amber | Proposed: cannot execute (environment down, dependency) |
| Skipped | `tablerCircleMinus` | gray-400 | Proposed: deliberately not run in this session |

Session progress bar: a 6px-high segmented bar in the order passed, failed, blocked, skipped, waiting, with a 2px gap between segments and `full` radius at the ends.

### Labels

Pill chip: 20px high, radius `full`, 1px `--tk-border`, transparent background, text `xs` 500 in `--tk-text-muted`, with a leading 6px dot in `--tk-palette-{n}`. `n = hash(label) mod 8` (FNV-1a on the lower-cased label), so a label has the same color everywhere. Rows show at most 2 chips, then `+3`.

### Avatars

Circle with initials (first letters of first and last name, `xs`/600). Background is the `--tk-palette-{hash(userId) mod 8}` tint at 20% (light) / 28% (dark), and the text is the matching `-fg`. An uploaded image replaces the initials. Unassigned shows a dashed 1px `--tk-border-strong` circle with a 12px `tablerUser` glyph in `--tk-text-subtle`. Stacks overlap by 6px and have a 2px ring in the surface color.

### Keys and counts

The ticket key (`PAY-128`) is `base`, tabular, `--tk-text-muted` in rows and `--tk-text` in detail breadcrumbs. Story points are a 20px `--tk-bg-muted` pill with tabular `xs` 500 text. Comment, child and test case counts use a 14px icon plus number in `--tk-text-subtle`, and are hidden when zero.

## 9. Charts (Chart.js)

- Read colors from CSS variables at render time (`getComputedStyle(document.documentElement)`) and re-render when the theme changes.
- Series colors come from the domain tokens: status, category and type charts use `--tk-status-*`, `--tk-category-*` and `--tk-type-*`. Generic series use `--tk-palette-0..7` in order.
- Gridlines are `--tk-border-subtle` on the y-axis only, with no x gridlines. Axes and ticks use `xs` in `--tk-text-subtle`. There are no chart borders or titles inside the canvas, because the card header is the title.
- Tooltips use the popover style: `--tk-surface-raised`, `--tk-border`, `shadow-md`, `sm` text.
- Animation is off (`animation: false`). Charts appear instantly, consistent with the speed principle.

## 10. Accessibility

- Focus: `outline: 2px solid var(--tk-focus); outline-offset: 2px` on controls, and `-2px` (inset) on rows and cards. Use `:focus-visible` only.
- Never use color alone: status has shape, priority has bars, badges have text, and failed items have an icon.
- Hit targets are at least 24×24px, even when the glyph is 14px.
- Respect `prefers-reduced-motion` and `prefers-contrast: more` (with more contrast, switch `--tk-border` to `--tk-border-strong`).
- The theme is stored per user (`light | dark | system`). An inline script in `index.html` sets `data-theme` before Angular boots, so the page does not flash in the wrong theme.
