# Layout and screens

Screen-level spec. Visual rules come from [`design-system.md`](./design-system.md). The pixel references are [`mockups/backlog.html`](./mockups/backlog.html), [`mockups/ticket-detail.html`](./mockups/ticket-detail.html) and [`mockups/board.html`](./mockups/board.html).

Each screen has a **view id** (in brackets in its heading). The id is the stable seam for future A/B variants: a route resolves `viewId → component`, and a feature flag can later map the same id to a variant component with the same inputs.

## 1. App shell

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│ ◆ Ticketing│ Payments › Backlog        [ Search or jump to…  ⌘K ]   + New  ? (AB) │  top bar 44px
│ ⌕ My work  ├──────────────────────────────────────────────────────────────┤
│            │                                                              │
│ PROJECTS   │  page header (title, count, view actions)            48px    │
│ ▾ PAY Paym…│  toolbar (filters, group, display)                   40px    │
│   Backlog  │  ─────────────────────────────────────────────────────────── │
│   Dashboard│  content (scrolls; headers stick)                            │
│   Test cas…│                                                              │
│   Regress… │                                                              │
│ ▸ ONB Onbo…│                                                              │
│ BOARDS     │                                                              │
│   Sprint 42│                                                              │
│ ADMIN      │                                                              │
│   Users    │                                                              │
│   Flags    │                                                              │
│ «  ◐       │                                                              │
└────────────┴──────────────────────────────────────────────────────────────┘
```

**Sidebar** (232px; collapses to a 48px icon rail with `[`; state persisted):
- Header: app mark and name (28px item). Clicking it goes to the project list.
- `My work`: tickets assigned to me across projects (a filtered backlog view).
- **Projects** section: favourites first, then recent, max 8 shown, then `All projects…`. Each project shows a colored 16px key tile and its name. Expanding a project reveals `Backlog`, `Board(s)`, `Dashboard`, `Test cases`, `Regressions`, `Settings`. The active route item uses `--tk-bg-active` with `--tk-text` (no colored bar).
- **Boards** section: boards I can see, with `+` on hover.
- **Admin** section (admins only): `Users`, `Feature flags`.
- Footer: collapse toggle and theme toggle (light / dark / system).
- Section labels use `xs` caps in `--tk-text-subtle`. A section collapses by clicking its label.

**Top bar** (44px, `--tk-bg`, bottom `--tk-border`):
- Left: breadcrumb (`Project › View`, or `Project › Parent key › Key` on ticket detail). Every segment is a link.
- Center: search trigger, a 320px fake input showing `Search or jump to…` and `⌘K`/`Ctrl K`. It opens the **command palette**: a 640px modal at 12vh from the top with `shadow-lg`. It offers a fuzzy search over tickets (by key or title), projects, boards and commands ("Create ticket", "Go to board…", "Toggle theme"). Results are grouped and keyboard-navigable, and the first result opens with Enter. Searching uses the API with a 120ms debounce and shows recent items instantly.
- Right: `+ New ticket` (primary, small; `C`), help `?` (shortcut sheet), user avatar menu (Profile, Access tokens, Theme, Density, Sign out).

**Responsive**: ≥1200px is the full layout. 900 to 1199px collapses the sidebar to the rail by default, and the peek panel overlays instead of pushing. Below 900px the sidebar becomes an off-canvas drawer and detail opens full page. Mobile is view-only best effort and not a target.

## 2. Cross-cutting patterns

### Ticket detail: peek panel + full page (recommended)

**Recommendation: one `TicketDetail` component, hosted two ways.**
- **Peek panel** (from backlog, board, test cases, search): a right-side panel, 640px, resizable. It pushes the list at ≥1440px and overlays below that. The list stays interactive, and `J/K` moves the selection while the panel follows, which makes triage fast. Single column: fields render as a compact 2-column property grid under the title. URL: `?peek=PAY-128`, so it survives reload and can be shared.
- **Full page** (`/p/PAY/t/PAY-128`) opens from deep links, `Shift+Enter`, or the "Open full page" button in the peek. It has a two-column layout (content max 760px + 280px field column), as in the `ticket-detail.html` mockup.

Why: a drawer alone is cramped for long markdown, test cases and comments. A full page alone loses list context and makes triage slow. Linear and Height use the same split.

### Inline editing
Status, priority, assignee, type, labels and points are edited through a **compact property picker**: our CDK component (Overlay + `cdkListbox`) styled as a command menu, with a type-to-filter input at the top and options showing icon + label + shortcut digit `1…8`. The backlog mockup shows it open. The update is optimistic, and a failure rolls it back with a danger toast offering `Retry`. Title edits happen in place: click it or press `E`. Enter or blur saves, Esc cancels.

### Version and labels hints
Version: a `mat-autocomplete` that lists this project's previously used versions (most recent first) and accepts free text. Labels: `mat-chip-grid` + `mat-autocomplete`, with chips rendered as our `LabelChip`. Suggestions are the project's labels ranked by use count, and an unknown value shows a `Create "foo"` option. Both suggestion lists are fetched once per project and cached.

### Loading, empty, error
- **Skeletons, never spinners, for lists, boards, tables, dashboards and detail.** A skeleton matches the real anatomy: row skeletons have a 14px circle, a 48px bar, a 40 to 70% title bar and a 20px avatar circle, with randomized widths seeded per row so they don't look like stripes. Show it only after a 120ms delay (fast loads never flash), and keep it at least 250ms once shown.
- **Refetch keeps the data on screen** (stale-while-revalidate). A 2px indeterminate accent line under the top bar is the only background-loading indicator.
- **Spinners** are allowed only inside a button whose action takes more than 300ms, and the button keeps its label and width.
- **Empty states**: centered in the content area, max 360px wide, with a 32px Tabler icon in `--tk-text-subtle`, a `lg` title, one muted sentence, a primary action, and the shortcut as a `Kbd`. No illustrations. Example: "No tickets in backlog · Create the first one or import from Jira. [New ticket C]". When filters match nothing: "No tickets match these filters · [Clear filters]".
- **Errors**: a load failure replaces the content with an inline panel (icon `tablerAlertCircle` in danger, title "Couldn't load the backlog", muted detail with a correlation id, `Retry` button). A mutation failure shows a toast (bottom-right, 5s, pauses on hover) with `Retry` or `Undo`. 403 shows "You don't have access to this project" with a link to the project list. 404 shows "PAY-999 doesn't exist or was moved". When offline, a warning bar sits under the top bar and mutations are queued.
- **Undo**: destructive bulk actions (delete, move to board) run immediately and show a toast with `Undo` (8s), with no confirm dialog. The exception is deleting a project, user or token, which uses a confirm dialog where you type the name.

### Performance budget (feel)
- Every list over 100 rows uses CDK virtual scroll with a fixed `itemSize = --tk-row-h`. Group headers are rows of the same height.
- Hovering a row for 150ms prefetches the ticket detail, so the peek opens with data already loaded.
- No layout shift: column widths are fixed, avatars and icons reserve space, and images have dimensions.
- Target: any interaction finishes its paint within 100ms, and route changes render cached data within 50ms.

## 3. Screens

### 3.1 Project list [`projects.list`]
- Header: "Projects", count, toolbar with search filter (`/`), segmented control `All · Mine · Public · Private`, and the `New project` button.
- Dense table rows (40px here, because each row carries a progress bar). Columns: key tile + name (+ description one-liner muted), visibility (`lock` = private, `globe` = public, icon + tooltip), lead avatar, open count, progress bar (120×4px segmented by category: done green / in progress blue / todo gray), last updated (relative).
- Click or Enter opens the project backlog. A row's `…` menu holds Favourite, Settings and Archive.
- New project dialog (480px): Name, Key (auto-derived uppercase from the name, 2 to 10 chars A to Z/0 to 9, editable, live-validated for uniqueness), Visibility (two radio cards), Description. Submit with `⌘↵`.
- Empty state: "No projects yet · Projects hold tickets, test cases and regressions. [New project]".

### 3.2 Project backlog [`backlog.list`] (mockup: `backlog.html`)
- Header: title "Backlog", count, and on the right a `Board` link and `Display` popover (row density, visible columns, show done).
- Toolbar (40px): filter chips `Type`, `Status`, `Priority`, `Assignee`, `Labels`, `Version` (each opens a multi-select popover, and an active chip shows `Status: 3` in accent-subtle), a text filter (`/`), `Group by: Status | Type | Epic | Assignee | None`, and `Sort: Rank | Priority | Updated | Created`. Filters live in the URL.
- **Group headers** (32px, sticky under the toolbar, `--tk-bg-subtle`) show a chevron, the status icon, the name, a count and, at the right, a `+` to quick-create in that group. Groups are ordered by category (in progress → todo → done) and Done is collapsed by default.
- **Row (32px)**, left to right: selection checkbox (visible on hover/selection/when any selected; 24px slot always reserved), priority, key (64px, muted, tabular), type icon, status icon, title (flex, truncates, `--tk-text`), severity badge (Critical/Major only), parent chip (epic glyph + truncated parent title, max 160px, muted, outlined), label chips (max 2 + `+n`), meta counts (children `3/5`, test cases, comments; hidden when 0), points pill, version (muted, 56px), assignee avatar (20px), updated (`Oct 22`, 48px, subtle). Hover uses `--tk-bg-hover`. The keyboard-focused row has a 2px inset accent bar on the left and `--tk-bg-hover`. Selected rows use `--tk-selection`.
- Clicking status, priority, assignee, points or labels in a row opens the inline popover without opening the ticket. Clicking anywhere else on the row opens the peek.
- **Multi-select**: `X`, checkbox, `Shift+click` or `Shift+↓/↑` for a range, `⌘A` for all in view. A floating **bulk bar** (bottom-center, `shadow-lg`, 40px) reads `3 selected` with Status, Priority, Assignee, Labels, Move to board…, Delete and `Esc` to clear.
- **Quick-create row**: `C` within the backlog, or the group `+`, inserts an inline row at the top of the group. It has a type selector (defaults to the last used type), a title input with placeholder `Ticket title`, and on the right hints `↵ create · ⇧↵ create & open · Esc`. After Enter the row stays open for the next ticket, and the new row flashes accent-subtle. The `C` key opens the full create dialog when it is pressed outside the backlog.
- Drag to reorder rank (CDK drag, handle = the whole row after 4px movement). Dropping on a group header changes that field. Drag is disabled when sorted by anything but Rank.

### 3.3 Ticket detail [`ticket.detail`] (mockup: `ticket-detail.html`)
- Header bar: breadcrumb, `n of N` with `↑ ↓` (or `K/J`) to step through the originating list, copy key (`⌘.`), copy link (`⌘⇧.`), `Open full page` (only in the peek), `…` (Move to board, Duplicate, Convert type, Delete).
- **Main column**:
  - Type icon + key (muted), title (`2xl` 600, click to edit).
  - **Description**: rendered markdown (`md` text, max 72ch measure). Click or `E`+`D` switches to a markdown editor (textarea with toolbar, `⌘B/I/K`, paste image upload, live preview toggle `⌘⇧P`), and Esc/blur saves. It supports GFM tables, task lists, code with highlighting, and ticket keys auto-linking (`PAY-101` becomes a link with a hover card).
  - **Child tickets**: section header "Sub-tickets 2/4" with a mini progress bar and `+ Add`. Children appear as compact 32px rows (status, key, title, assignee) and can be reordered by drag. `Add` offers create-new inline or link-existing (search popover).
  - **Test cases**: header "Test cases 3" with a `+ Add` button. Each row shows the status badge (New/Manual/Automatic), title, step count and a last-run result dot. Expanding a row reveals its numbered steps inline (editable list; Enter adds a step, drag reorders, `⌫` on an empty step removes it).
  - **Activity**: tabs `Comments · History · All`. Comments are cards with a 24px avatar, name, relative time (absolute on hover) and markdown body. Your own comments get `Edit`/`Delete` on hover. History entries are single muted lines with a 14px icon, such as "Anna moved from Review to Ready for Testing · 2h". The composer sits at the bottom of the main column (a sticky-on-focus textarea) with `⌘↵ Comment`.
- **Field column** (280px, `--tk-bg-subtle` panel, label/value rows of 32px, labels 96px `sm` muted): Status (button styled with status icon + name; also `S`), Priority (`P`), Severity, Type, Assignee (`A`, plus "Assign to me" `I`), Reporter, Story points, Version, Labels (`L`), Parent (`⇧P`), Board / Backlog location, Created, Updated. Values are ghost buttons that become the hover background, with no visible input chrome until edited.
- Concurrency: if the ticket changes on the server while open, a subtle bar "Updated by Anna · Reload" appears. Edits to untouched fields merge silently.

### 3.4 Board [`board.kanban`] (mockup: `board.html`)
- Header: board name, project chips (boards span projects), `Group by: None | Project | Assignee | Epic | Priority`, filters (same chips as backlog), `Display` (show empty columns, card fields), `+ Add tickets` (search popover over backlogs; adding moves the ticket from its backlog onto the board).
- **Columns**: one per status, in workflow order, 272px wide, `--tk-bg-subtle`, radius `lg`, 8px gap. The board scrolls horizontally with trackpad, `Shift+wheel` or by dragging empty space. The column header is sticky and holds the status icon, name, count and `+`. Columns can be collapsed to a 40px vertical strip showing the name and count, which suits On Hold. The Done column shows the last 14 days with a "Show older" link.
- **Swimlanes** (when grouped): full-width lane header row (32px, sticky left) with chevron, avatar or project tile, name, count, and story points sum. Lanes collapse independently. An empty lane cell is a 48px drop target.
- **Card** (`--tk-surface`, 1px `--tk-border`, radius `lg`, padding 10px, `shadow-xs`): line 1 has the type icon, key (muted, tabular) and the avatar at the right. Lines 2 to 3 hold the title (2-line clamp, `base` 500). The footer has priority, severity (if Critical/Major), up to 2 labels, child progress `2/4` and points. Hover gives `--tk-border-strong`; focus gives the inset 2px focus outline; selected gives `--tk-selection` plus an accent border.
- **Drag and drop (CDK)**: drag starts after 4px. The lifted card shows `shadow-lg` and `scale(1.02)`, with no tilt. The source slot stays as a dashed placeholder with `--tk-border-strong`, and target columns highlight with `--tk-bg-hover`. Dropping into a column sets the status optimistically. Transitions not allowed by workflow (if any later) show the column as dimmed with a `not-allowed` cursor. Within a column, dragging reorders rank. Keyboard: `Space` picks up, arrows move, `Space` drops, `Esc` cancels.
- Click opens the peek panel, and `J/K` and `H/L` (or arrows) move the focus between cards and columns.

### 3.5 Project dashboard [`project.dashboard`]
- 12-column grid, 16px gap, cards `--tk-surface` with 1px border, radius `lg`, header 40px (`lg` title + muted period selector).
- **KPI tiles** (row of 6, 2 columns each, 88px tall): label `sm` muted, value `3xl` tabular, delta vs previous period `xs` (green/red with arrow; for bugs, down is good) and an optional 24px sparkline. The tiles are: Open tickets · In progress · Done (14d) · Open bugs (with `n critical` in danger-fg) · Story points done (14d) · Last regression pass rate.
- Charts (Chart.js, `animation: false`):
  - Status distribution: horizontal 100% stacked bar per category, with a status-level breakdown on hover (6 columns).
  - Created vs resolved: two lines over 30 days, created `--tk-palette-0`, resolved `--tk-category-done` (6 columns).
  - Tickets by type: horizontal bars in type colors (4 columns).
  - Open bugs by severity: bars in the severity colors (4 columns).
  - Regression history: stacked columns per session, passed/failed/blocked/skipped (4 columns).
  - Recent docs (12 columns, last row; spec §12.15): 32px rows with the kind icon, title, folder path (muted), editor avatar and relative time, opening the doc; "N docs" in the header links to the Docs home.
  - Every chart has an accessible data table toggle (`Table` icon button) for screen readers and exact numbers.
- Clicking a bar segment navigates to the backlog with the matching filter.
- The loading skeleton mirrors the tile and card frames, and charts render as a flat `--tk-skeleton` block.

### 3.6 Test cases [`testcases.list`]
- Header "Test cases" with a count, and segmented tabs `All · New · Manual · Automatic` with counts.
- Toolbar: text filter, `Ticket`, `Last result` filter, `Group by: Ticket | Status | None`.
- Row 32px: status badge (fixed 84px slot), id `TC-42` (muted), title, linked ticket chip (type icon + key, which opens the peek), steps count, last result (regression status icon + session name in a tooltip), updated.
- Bulk: select, then `Mark manual` / `Mark automatic`.
- Peek panel (same pattern as tickets): title, status segmented control (New / Manual / Automatic), steps editor (numbered, drag reorder), linked ticket, and a history of results across sessions (mini timeline of dots).

### 3.7 Regressions list [`regressions.list`]
- Rows (40px): session name ("Regression 2.4.0"), version, created by + date, segmented progress bar (180px, see design-system §8) with `18/24` executed, failed count in danger-fg when > 0, state badge `In progress` (blue) / `Completed` (green).
- `New session` dialog: Name (prefilled "Regression {next version}"), Version (autocomplete). A summary line reads "**24 manual** cases will be added as *Waiting for execution* · **61 automatic** cases will be marked *Passed*". `Create session` opens the execution view.

### 3.8 Regression session execution [`regressions.session`]
- Header: name, version, state, a large segmented progress bar (full width, 8px) with a legend and counts, and `Complete session` (enabled once nothing is Waiting; confirm if any are Blocked).
- Toolbar: `Mine · Unassigned · All`, a status filter, and a text filter.
- **Two panes**: on the left, the item list (400px). Rows are 36px with the status icon, title, ticket key (muted), and either the assignee avatar or a ghost `Assign to me` on hover. Rows are grouped by status with Waiting first. On the right, the execution pane for the focused item:
  - Title, linked ticket, assignee field.
  - **Steps** as a numbered list with per-step check-off (local aid only, not persisted) for following along.
  - Action bar (sticky bottom, 48px): `Pass P` (success solid), `Fail F` (danger solid), `Blocked B`, `Skip S` (ghost), `Next waiting N`.
  - **On Fail** an inline panel slides open below the actions (150ms). It contains "What went wrong?" (markdown textarea, autofocus) and a `Create bug in backlog` toggle (on by default). The bug preview shows: title `[Regression] {case title}`, priority/severity selects (defaults High / Major), and the description prefilled with the session name, the case's steps as "Steps to reproduce", and the actual result from the textarea. `⌘↵` confirms. The item then shows the bug chip `PAY-142` linking to the bug, and the focus advances to the next waiting item.
- Automatic cases appear already `Passed` with a `tablerRobot` icon and are not actionable, apart from overriding to Failed via the `…` menu.
- Multi-user: the list shows live updates via polling or SSE. Items another user assigned to themselves show their avatar, and the `Assign to me` action asks for confirmation before reassigning.

### 3.9 Admin: users [`admin.users`]
- `mat-table` (32px rows). Columns: avatar + name, email, roles (chips), status badge (`Active` green / `Disabled` gray), last active, token count, `…`.
- Toolbar: search, role filter, `Invite user` / `New user`.
- Create/edit opens the peek panel (480px) with name, email, roles (multi-select checkboxes with a one-line description of each role) and active toggle. Disabling a user confirms and lists their open assignments count.
- Empty and permission states follow the patterns above.

### 3.9a Profile → general [`profile.general`]
- Cards, max 640px: Profile (email, role, display name), **Avatar**, Password.
- Avatar card: a live preview (32px avatar, and a mock card row with the 20px avatar); an "Animal" radio group of 48px tiles tinted with the current colour (roving tabindex: arrows in 2D, Home/End, Enter/Space picks; skeleton tiles while the art loads); a "Colour" radio group of `Automatic` plus the 8 palette colours, each swatch showing the avatar in that colour; `Use initials` (stroked, disabled when no animal is picked). Every pick saves at once, optimistically, with a toast and rollback on failure.

### 3.10 Profile → access tokens [`profile.tokens`]
- Profile page has tabs `General · Access tokens · Preferences` (Preferences: theme, density, keyboard shortcut hints on/off).
- Tokens table: Name, Token prefix (`tkt_pat_3fA9…` in mono, muted), Scopes (chips such as `api:read`, `api:write`, `mcp`), Created, Last used (relative, or "Never" in subtle), Expires (in warning-fg when under 7 days, "Expired" danger badge), and `Revoke` (ghost danger, with a confirm popover).
- `Generate token` dialog (480px): Name (required, e.g. "Claude Code laptop"), Expiration (`30 days`, `90 days` (default), `1 year`, `No expiration` with a warning hint) and Scopes (checkbox list with descriptions).
- **Show-once dialog** (560px, cannot be dismissed by clicking outside):
  - Success icon + title "Token created".
  - A warning callout: "Copy this token now. You won't be able to see it again."
  - A 36px read-only mono field showing the full token, with a `Copy` button that turns into `Copied ✓` for 2s. The field is also selected on focus.
  - Collapsible "Use with Claude Code" snippet showing an MCP config example (mono, copy button).
  - Footer: the `Done` primary button. If the token was never copied, the first `Done`/`Esc` press turns into an inline confirm "Close without copying? The token will be lost.", and a second press closes.
  - The token string is never stored in client state after close.

### 3.11 Admin: feature flags [`admin.flags`]
- Table rows (40px): flag key (mono, e.g. `board.swimlanes`), description (muted), state toggle (`mat-slide-toggle`), rollout summary ("100%", "25% of users", "Roles: Admin", "Variant B 50/50"), last changed by + when.
- Toggling applies optimistically and shows a toast "`board.swimlanes` turned on · Undo".
- Clicking a row opens the peek panel with: description, a kill-switch toggle, targeting (everyone / percentage slider / roles / specific users) and **variants** for A/B (name + weight list summing to 100%, a `control` variant required, and the view id it targets, e.g. `backlog.list`). The panel also shows an audit log of changes.
- New flag dialog: key (lower.dot.case, validated), description, default off.

## 4. Keyboard shortcuts

Single-key shortcuts are inactive while focus is in an input, textarea or contenteditable. `⌘` means `Ctrl` on Windows and Linux, and the UI shows the platform glyphs. `?` opens the shortcut sheet: a modal with sections, searchable. Tooltips on actions include the shortcut as a `Kbd`.

| Scope | Keys | Action |
|---|---|---|
| Global | `⌘K` | Command palette / search |
| | `C` | Create ticket (quick-create row in backlog, dialog elsewhere) |
| | `/` | Focus the view's filter |
| | `G` then `B` / `O` / `D` / `T` / `R` / `P` | Go to Backlog / bOard / Dashboard / Test cases / Regressions / Projects |
| | `[` | Toggle sidebar |
| | `?` | Shortcut sheet |
| | `Esc` | Close popover / peek / clear selection (innermost first) |
| Lists and boards | `J` / `K` or `↓` / `↑` | Next / previous item |
| | `H` / `L` or `←` / `→` | Board: previous / next column |
| | `Enter` / `Shift+Enter` | Open peek / open full page |
| | `X`, `Shift+↓/↑`, `⌘A` | Select, extend selection, select all |
| | `S` `P` `T` `A` `L` | Status, priority, type, assignee, labels picker (applies to the selection, or to the focused item; D-81) |
| | `I` | Assign to me (with undo toast) |
| | `M` | Backlog: move to a board (picker) |
| | `1`…`8` inside the status popover | Pick status by order |
| | `Shift+H` / `Shift+L` | Board: move card to previous / next status |
| | `Del` / `⌘⌫` | Delete, Owners only (with undo toast, D-82) |
| Ticket | `S` `P` `T` `A` `L` / `I` | Status, priority, type, assignee, labels picker / assign to me |
| | `M` | Move to the backlog or a board |
| | `Del` / `⌘⌫` | Delete, Owners only (with undo toast) |
| | `E` | Edit title |
| | `Shift+E` | Edit description |
| | `⌘.` / `⌘⇧.` | Copy key / copy link |
| | `⇧P` | Set parent |
| Regression session | `P` / `F` / `B` / `S` | Pass / Fail / Blocked / Skip the focused item |
| | `N` | Next waiting item |
| | `I` | Assign to me |
| Forms and dialogs | `⌘↵` | Submit |
