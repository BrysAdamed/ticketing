# Docs: screens

Per-project documentation area that replaces Confluence. Status: refinement, nothing implemented. Visual rules come from [`../design-system.md`](../design-system.md) and tokens from [`web/src/styles/_tokens.scss`](../../../web/src/styles/_tokens.scss). The shell, top bar, peek panel and loading patterns follow [`../layout-and-screens.md`](../layout-and-screens.md).

Mockups (static HTML with light and dark themes; the Theme button switches between them):
- [`docs-page.html`](./docs-page.html): tree, page and right rail. A mockup-only switcher in the bottom-right corner also shows the docs home, the empty state, loading, history, PDF export and `Ctrl K` search.
- [`docs-edit.html`](./docs-edit.html): edit mode with the split editor, the slash menu and a diagram block.
- [`whiteboard.html`](./whiteboard.html): the full-screen diagram editor overlay around the embedded engine.

Where these mockups and [the refinement](../../product/03-docs-refinement.md) differ, the refinement wins: diagram docs are embedded with `![caption](KEY)`, not the mockups' ` ```drawing ` fence; the "Templates" entry is out of scope (I-82, Duplicate covers it); the Canvas engine is Excalidraw (refinement §5); page comments (TKT-21) appear below the page content.

## 0. Key decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Markdown is the stored format.** One page is one markdown document, plus attachments and drawings that it references by id. | Agents can read and write a page through MCP as plain text. History diffs are line-based and readable. Export, search and backup are simple, and we avoid lock-in to an editor's JSON schema. |
| D2 | **v1 editor: a markdown source editor (CodeMirror 6) with a live preview.** The layouts are Write, Split and Preview, and Split is the default from 1200px up. WYSIWYG is deferred. | It is fast: CodeMirror stays smooth on long pages, and preview rendering is debounced to 150ms. It is LLM-friendly, since what you type is what gets stored, so nothing is lost converting between rich text and markdown. It reuses the ticket description editor (same markdown dialect, ticket auto-links and image paste). The slash menu and toolbar cover what non-developers need. Because the source is markdown, a TipTap or Milkdown WYSIWYG mode can be added later as another view of the same document. |
| D3 | **Two kinds of diagram, both shown as a *diagram block*.** (a) A `mermaid` fenced code block, which is text, diffable and easy for LLMs to write. (b) A **drawing**, written ```` ```drawing id=drw_… ```` , which is a scene from the embedded visual engine stored next to the page together with an SVG snapshot. | Mermaid covers sequence, flow and state diagrams that live in git-like text. Drawings cover freeform boxes, arrows and sketches. The engine (Excalidraw, MIT, or self-hosted draw.io, Apache 2.0) sits behind one `DiagramEditor` seam (scene in, scene + SVG out), so either one fits the same chrome. |
| D4 | **The tree has folders, pages and whiteboards.** Folders contain items and have no body. Pages and whiteboards are leaves. | Exporting a whole folder and syncing it like a file system are straightforward. Open question Q1 asks whether pages may also have child pages, as in Confluence. |
| D5 | **There is no real-time co-editing in v1.** Edits autosave as a draft. Done (or 10 minutes idle) publishes a version. A second editor sees a presence banner, and a stale save gets a merge prompt. | This keeps the backend simple. Saving on every keystroke without CRDTs would create conflicts. |
| D6 | **Ticket keys auto-link** (`PAY-12`) and **page links** use `[[Page title]]`, which autocompletes to a stable id. | These links feed the right rail (Linked tickets, Backlinks) and the ticket section "Docs mentioning this ticket". |

View ids (seams for A/B testing): `docs.home`, `docs.page`, `docs.page.edit`, `docs.history`, `docs.whiteboard`, `docs.diagram-editor`, `docs.export`.
Routes: `/p/PAY/docs`, `/p/PAY/docs/{pageId}/{slug}`, with `?mode=edit`, `?history={version}` and `?diagram={blockId}`. A slug change never breaks a link, because the link resolves by id.

## 1. Sidebar entry

Under an expanded project the items are `Dashboard · Backlog · Test cases · Regressions · Docs · Settings`. Docs uses `tablerBook` and sits after Regressions, because Settings always stays last. The shortcut is `G` then `W` (wiki), since `G D` is already Dashboard. No count is shown. The item is visible to everyone who can see the project. A future project setting can hide it.

## 2. Docs home [`docs.home`]

The tree stays on the left. The content area (max 808px) has:
- Header "Docs" (`xl`), the page count (muted), and on the right `Export…` (ghost) and `New page` (primary, `N`).
- **Continue reading**: up to 6 pages I viewed recently, shown as 2 rows of 3 compact cards (title, folder path in muted text, "viewed 2h ago").
- **Recently updated**: 32px rows with a page or whiteboard icon, the title, the folder path (muted, truncated), the editor avatar and the relative time. The list shows 20 rows plus "Show more".
- **Empty state** (no pages yet): the standard empty pattern: a 32px `tablerBook` icon, "No docs yet", "Write specs, runbooks and diagrams next to your tickets.", `Create first page N` (primary) and `New folder`. Under it, a templates hint shows a row of chips: *Technical design · Runbook · ADR · Meeting notes · Release notes*. Each chip creates a page prefilled from a markdown template, and a template can include a Mermaid block. Templates are files in the repository for v1. Editing templates per project comes later.

## 3. Page layout: three panes [`docs.page`]

```
┌sidebar┬ Payments / Docs / Architecture / Payment flow     [Search ⌘K]   + New ticket ┐
│       ├─tree 256──────┬─page bar 40: ▤ Architecture · Edited by DO 2h · v14   ⟲ ⤓ ⋯ [Edit E] ┤
│ Docs ◀│ DOCS   ⌕  +   │                                                ├ rail 248 ──┤
│       │ Filter pages /│  Payment flow  (2xl)                           │ ON THIS PAGE│
│       │ ▾ Architecture│  DO Daniel · Updated Oct 25 · 6 min read       │ ▍Overview   │
│       │   Overview    │  ## Overview …                                 │  Sequence   │
│       │   Payment flow│  ┌ diagram block ─────────── Edit diagram ⤢ ┐  │ LINKED TICK │
│       │   ⌗ System map│  │ rendered sequence diagram                  │  │ ◔ PAY-12 …  │
│       │ ▸ Runbooks  4 │  └────────────────────────────────────────────┘  │ BACKLINKS   │
│       │ Templates·Trash│  table · code · [◔ PAY-12 Save the payment…]  │ PAGE INFO   │
└───────┴───────────────┴────────────────────────────────────────────────┴─────────────┘
```

**Tree pane** (256px, resizable from 200 to 400px, width remembered; `Ctrl Shift E` focuses it):
- Header (40px): "Docs", a search icon (filter) and `+` (menu: New page `N`, New folder `Shift N`, New whiteboard, From template…).
- Filter input (`/`) narrows the tree to matching titles and keeps their ancestors expanded.
- Rows are 28px, indented 16px per level, with a 16px chevron slot, an icon (folder, page or whiteboard) in `--tk-text-subtle`, and the title. A folder shows its item count, which hover replaces with the `+` and `…` actions. The active page uses `--tk-bg-active` and weight 500. Folder expansion is remembered per user.
- **Drag and drop** (CDK, starts after 4px): a 2px accent line shows the insert position, indented to the target depth. Hovering a folder for 500ms expands it, and dropping onto a folder row highlights the row in `--tk-accent-subtle` and moves the item inside. Moves are optimistic, with an undo toast. The keyboard equivalents are `Alt ↑/↓` to reorder and `M` for Move to… (a folder picker).
- **Context menu** (right-click, `…` or `Shift F10`): New page / folder / whiteboard here (folders only), Rename `F2`, Duplicate, Move to… `M`, Copy link `Ctrl Shift .`, Export PDF… `Ctrl P`, Version history `H`, then a separator and Delete `Del`. Delete moves the item to Trash with an undo toast. Deleting a folder deletes its contents and says how many items that is.
- Footer: `Templates` and `Trash`. Trash keeps items for 30 days. Owners can restore or purge them.

**Page bar** (40px, sticky): a folder icon and path, "Edited by {avatar} Daniel Okafor · 2h ago", and `v14`, which opens history. On the right are History `H`, Copy link, Export PDF `Ctrl P`, a `…` menu (Move, Duplicate, Watch, Delete) and `Edit E`. Edit is a secondary button because the view has no primary action.

**Page content**: max width 808px (72ch prose at `md` 14/22). Title `2xl`, then a meta line (author, updated date, reading time). Markdown rendering is the same as in ticket descriptions, with heading anchors (hovering an `h2`/`h3` shows a `#` that copies the link). Ticket mentions render as **ticket chips** (status ring, muted key, title, and a hover card after 400ms). Page links render in accent color with a page icon. Callouts (`> [!NOTE]`, `> [!WARNING]`) use the info and warning tints. Code blocks have a 32px header with the language and Copy.

**Right rail** (248px; `]` toggles it; at 900 to 1199px it collapses into an "On this page" popover button in the page bar):
- **On this page**: the `h2` and `h3` outline. The current section, found by scroll spy, gets a 2px accent bar, and clicking an entry scrolls smoothly (instantly under reduced motion).
- **Linked tickets n**: tickets mentioned in the page, shown as rows with the status ring, key and title. Clicking a row opens the ticket peek over the page. `+ Link` opens the ticket search and inserts the mention at the end of the page.
- **Backlinks n**: pages that link here, each with its title and path.
- **Page info**: created by, updated, versions → History, watchers.

## 4. View mode and edit mode [`docs.page.edit`]

- `E` (or the Edit button, or a double-click on the prose) enters edit mode in place, with no route change apart from `?mode=edit`. The tree stays visible, and the right rail is hidden to make room for the split.
- **Edit bar** (40px) replaces the page bar. On the left is the save state: "Saving…" or "Draft saved 4s ago" (muted), or "Offline, changes kept locally" in warning color. Presence follows ("Anna is viewing"). In the center are the Write, Split and Preview segments (`Ctrl Shift P` cycles them). The toolbar holds Heading, Bold, Italic, Code, Link `Ctrl K`, List, Table, Ticket, Diagram and Image. On the right are `Discard` (ghost) and `Done Ctrl ↵` (primary), which publishes a version.
- **Source pane**: CodeMirror styled from tokens. Mono 13/20 with a 16px gutter and no line numbers. Headings are semibold, markers are `--tk-text-subtle`, links and keys use `--tk-accent-fg`, fences have a `--tk-bg-subtle` band, and the active line has `--tk-bg-hover`. The preview scroll follows the source.
- **Slash menu**: `/` at the start of a line opens a filtered command list: Heading, Table, Code block, Mermaid diagram, Drawing, Ticket link, Page link, Callout, Image, Template… It is the same CDK listbox as the property picker. `[[` autocompletes pages, and typing `PAY-` autocompletes tickets.
- **Preview pane**: the real renderer, so the preview looks exactly like view mode. Diagram blocks are live: a Mermaid block re-renders 300ms after typing stops, and a syntax error shows an inline danger callout with the line number while the last good render stays visible.
- **Conflicts**: if someone else published while you edit, a bar reads "Daniel published v15 · Review changes". Review opens a 3-way diff. Your draft is never lost.
- Leaving with unpublished changes keeps the draft. The tree marks the page with a small dot, and opening the page offers "Continue editing".

## 5. Diagram block and full-screen editor [`docs.diagram-editor`]

**In the page**: a figure with a 1px border, radius `lg`, and a 36px header showing the kind icon, a label (`Mermaid · sequence` or `Drawing`), and the actions `Edit diagram`, Full screen and `…` (Copy as SVG/PNG, Copy source, Delete). The header actions show on hover or focus, and always on touch. The body is the rendered SVG, centered, with a fixed aspect ratio stored with the block so nothing shifts on load. An optional caption sits below in `sm` subtle text. `Enter` on a focused block or a double-click opens the editor.

**Full-screen editor overlay** (a CDK overlay over the whole app, with a `--tk-overlay-mask` behind it so you know you are inside a page):
- Header (48px, our chrome): Close `Esc` (asks for confirmation if there are unsaved changes), the diagram icon, an editable title, the context "in Payment flow" (muted), and the save state. On the right: Undo and Redo, Export (SVG/PNG), the theme toggle, `Cancel` and `Save & close Ctrl ↵` (primary).
- Body: the **engine region**, an iframe for draw.io embed mode or a lazy-loaded island for Excalidraw. Our CSS variables theme it: canvas `--tk-bg`, grid dots `--tk-border`, and the selection is accent. The engine keeps its own tool shortcuts (V select, H hand, R rectangle, D diamond, O ellipse, A arrow, L line, P pen, T text, E eraser). The tool rail and property panel follow the engine's layout, restyled with our radii, borders and icons where the engine allows it. The mockup shows the target look.
- For **Mermaid**, the same overlay has a split instead of a canvas: code on the left (CodeMirror), live render on the right, and an error strip at the bottom.
- Save writes the scene JSON together with the light-theme SVG snapshot, which is used for view, PDF and search (the text in the shapes is indexed). In dark mode a drawing snapshot renders with `filter: invert(.93) hue-rotate(180deg)`, the Excalidraw approach, which keeps user colors recognisable. Mermaid re-renders with themeVariables read from CSS variables, as charts do.
- Shapes can carry a link to a ticket or page (`PAY-12`). On the canvas the link shows as a small chip, and it is clickable in view mode.

## 6. Standalone whiteboard [`docs.whiteboard`]

A tree item of type Whiteboard (`tablerChalkboard`). It opens inside the app layout: the tree stays visible and the canvas fills the content area under a 40px bar (title, editors' presence, Edit or View, Export, `…`). It starts in view mode (pan and zoom only), and `E` makes it editable with the same engine chrome as the overlay but without the mask. A page can embed a whiteboard with `![[Checkout system map]]`, which renders the snapshot and links to it. History, export and backlinks work the same as for pages.

## 7. Version history [`docs.history`]

- `H`, the `v14` badge or the page menu opens a 320px **history panel** in place of the right rail. Versions are grouped by day. Each row has an avatar, name, time and change summary (`+12 −3 lines`, "Diagram edited", "Restored from v9"), and the current version is marked `Current`.
- Selecting a version turns the content area into a diff view with the toggle `Changes | Rendered`. *Changes* is a unified source diff with word-level highlights (`--tk-success-bg` for added, `--tk-danger-bg` for removed lines with strikethrough) and collapsed unchanged hunks ("··· 24 unchanged lines"). *Rendered* shows the old version read-only. A changed diagram shows the before and after snapshots side by side.
- Actions: `Restore this version`, which creates a new version and is never destructive, Copy link to the version, and compare with any version (`Shift`-click a second row). `Esc` closes the panel.

## 8. PDF export [`docs.export`]

A dialog (520px, `MatDialog`) opened with `Ctrl P` (which intercepts the browser print), the page bar button or the tree menu:
- **Scope** as radio cards: *This page* or *Folder "Architecture" (6 pages)*, plus *Include subfolders* for folders. Opened from a folder, the folder option is preselected.
- **Contents** as checkboxes: Table of contents (on by default for folders, with a page number per page and heading), Include diagrams (vector SVG; drawings print in light theme), Linked tickets appendix (key, title and status at export time), Page metadata (author, version and date in each page header).
- **Paper** as segmented controls: `A4 | Letter` (A4 by default for the Polish locale), `Portrait | Landscape`. A wide-table hint suggests Landscape when a page has tables with 6 or more columns.
- Footer: an estimate ("6 pages · ~14 PDF pages"), then `Cancel` and `Export PDF` (primary, `Ctrl ↵`).
- The export is rendered on the server (headless Chromium with print CSS). One page downloads directly. A folder export runs in the background, a toast shows progress ("Exporting Architecture · 3/6"), and the toast ends with `Download`. The file name is `PAY-Architecture-2026-10-27.pdf`.

## 9. Search (Ctrl K) and ticket integration

- **Command palette**: a **Pages** group comes after Tickets. Rows are 44px: a page or whiteboard icon, the title with the match highlighted, the path (muted), and a second line with a snippet of the matching text (`sm` muted, match in `--tk-text` weight 500). Results are scoped to the current project first, then to other projects with a project tile. Prefix filters `p:` (pages) and `t:` (tickets) narrow the search. Commands include "New page", "Go to docs" and "Export page as PDF". Full-text search covers titles, headings, body text, code, Mermaid source and drawing text.
- **Ticket detail**, section **"Docs mentioning this ticket n"**, between Test cases and Activity, shown only when n > 0. It lists compact 32px rows: page icon, title, folder path (muted), "mentioned by Daniel · Oct 25" (subtle). Clicking a row opens the page and scrolls to the first mention, which flashes `--tk-accent-subtle` for 600ms. `+ Write doc` creates a page in the project's default folder, prefilled with `Related: PAY-12`.

```
Docs mentioning this ticket 2                                           + Write doc
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ▤ Payment flow          Architecture             Daniel Okafor · Oct 25          │
│ ▤ Stripe outage         Runbooks                 Sara Lis · Oct 12               │
└──────────────────────────────────────────────────────────────────────────────────┘
```

## 10. Keyboard shortcuts (Docs scope)

Single-key shortcuts are inactive while typing, as everywhere in the app.

| Keys | Action |
|---|---|
| `G` then `W` | Go to Docs (global) |
| `N` / `Shift N` | New page / new folder in the current folder |
| `E` | Edit page (or whiteboard) |
| `Ctrl ↵` / `Esc` | Done (publish) / leave edit mode (draft kept) |
| `Ctrl S` | Save draft now |
| `Ctrl Shift P` | Cycle Write / Split / Preview |
| `/` (in editor, at line start) | Slash menu |
| `[[` / `PAY-` | Page link / ticket autocomplete |
| `H` | Version history |
| `Ctrl P` | Export PDF |
| `]` | Toggle right rail (`[` is the app sidebar) |
| `Ctrl Shift E` | Focus page tree |
| Tree: `↑ ↓ ← →`, `Enter`, `F2`, `Alt ↑/↓`, `M`, `Del` | Move, expand/collapse, open, rename, reorder, move to…, delete |
| Diagram block: `Enter` | Edit diagram |
| Diagram editor: `Ctrl ↵` / `Esc` / engine keys | Save & close / close / tools (V H R D O A L P T E) |
| `Ctrl .` / `Ctrl Shift .` | Copy page link / copy link to the current heading |

## 11. Loading, empty, error

- **Skeletons** (shown after 120ms, kept at least 250ms):
  - Tree: 10 rows with a 14px square and a bar of 40 to 80% width, with indents varied per row.
  - Page: a title bar (55%), a meta bar (30%), then paragraph lines of seeded widths, with a 200px block where a diagram is (its height comes from the stored aspect ratio).
  - Rail: 5 short bars.
- Recently viewed pages render from the cache immediately, and revalidation shows only the 2px top line.
- Diagram blocks never block the page: the stored SVG snapshot paints first, and Mermaid that has never been rendered shows a block skeleton of the stored height.
- **Errors**: "Couldn't load this page" with Retry and a correlation id. A 404 shows "This page was deleted or moved", with `Open Trash` if you may restore it. An engine load failure in the overlay shows "Diagram editor didn't load", with Retry and "Edit as Mermaid" when the block is Mermaid.

## 12. Light and dark

Both themes use semantic tokens only. Prose, tables and code blocks use `--tk-bg-subtle` and `--tk-border`. Code syntax uses hue `-fg` tokens. Mermaid gets its themeVariables from tokens at render time and re-renders when the theme changes. Drawing snapshots use the invert filter in dark mode and always export in light. The diagram editor canvas follows the app theme and passes `theme: dark|light` to the engine.

## 13. Open questions (for product refinement)

- Q1: Should pages also have child pages (Confluence style), or only folders (D4)?
- Q2: Do Docs permissions follow project visibility only, or do we need per-folder restrictions?
- Q3: Which engine: Excalidraw (lighter, sketchy look, MIT) or draw.io (richer shapes, heavier iframe)? The design fits both (D3).
- Q4: Should editing templates be per project in v1, or are the built-in templates enough?
- Q5: Is a Confluence import (storage format to markdown) in scope? This affects the folder model.
