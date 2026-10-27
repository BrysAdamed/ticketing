# Docs for Ticketing: refined spec, triage, open questions, ticket breakdown

Refinement for spike [TKT-9](http://localhost:8090/tickets/TKT-9) "Refine project Docs (Confluence replacement) with diagrams, whiteboard and PDF export". Library and licence research: [../research/docs-and-diagrams.md](../research/docs-and-diagrams.md).

Owner's idea (verbatim):

> Each project requires some documentation so something that replaces the confluence would be beneficial. A new tab on the project named Docs, with folders, and pages written in markdown will be sufficient. We will need to however add the ability to make some diagrams and insert some shapes and arrows or a whiteboard that allows to draw freely, as they are really helpful usually. There should be a way to export each one of them to pdf.

Numbering: spec §12 "Docs", decisions D-97 to D-117 (D-93 to D-96 went to watchers, notifications, the sub-tickets graph and mentions while this was refined), ideas I-82 onwards.

---

## 1. Refined v1-of-Docs spec

### 1.1 Scope and placement
- Docs becomes a new project section: a sidebar sub-item **Docs** under each project. D-83 says project sections live in the sidebar, so it is not a header tab, even though the owner said "tab". View ids are `docs.home`, `docs.page`, `docs.diagram`, `docs.history` and `docs.trash`.
- Layout is two panes:
  - Left: a tree panel, 280 px, resizable 200–480 px, collapsible with `Ctrl \` (D-109; `[` is the app sidebar). It is per project and its state is persisted.
  - Right: the content. A page body is at most 760 px wide. At ≥1440 px a 220 px "On this page" rail sits on the right.
- One project owns three kinds of documents:
  - **Folders.**
  - **Pages**: markdown.
  - **Diagrams**: either Mermaid source or a visual Canvas covering shapes, arrows and free drawing.
- Pages can also contain inline ```` ```mermaid ```` blocks and can embed diagrams.
- Non-goals for v1:
  - A WYSIWYG editor. The owner asked for markdown.
  - Real-time co-editing.
  - Per-page permissions.
  - Cross-project spaces.
  - Comments on pages (§2 and Q-10).

### 1.2 Diagram decision (recommended; Q-06 asks the owner to confirm)
I recommend both forms:
- **Mermaid** for diagrams-as-code. It works inline in any page and as a standalone Mermaid diagram document. It is what LLMs write well, it diffs as text and it is searchable.
- **Canvas** is a standalone diagram document edited in the visual editor. It covers shapes, connectors, text, free drawing and a whiteboard.

Both diagram kinds:
- are tree nodes with their own key, versions and PDF export;
- embed into any page by key;
- support every library the researcher is considering. The stored `Source` is the library's native text format: JSON for Excalidraw, XML for draw.io. The spike decides which.

### 1.3 Domain model

New enums:

| Enum | Values |
| --- | --- |
| `DocKind` | `Folder`, `Page`, `Diagram` |
| `DiagramFormat` | `Mermaid`, `Canvas` |
| `DocReferenceTarget` | `Ticket`, `Doc` |

`ActivityEntityType` gains `Doc`. `Project` gains `NextDocNumber int` (starts at 1) through an additive migration.

**DocNode** (one table for all three kinds)

| Field | Type | Constraints |
| --- | --- | --- |
| Id | uuid | UUIDv7 |
| ProjectId | uuid | Immutable. Moving a doc to another project is LATER. |
| Number | int | Taken from `Project.NextDocNumber` with the same race-free `UPDATE … RETURNING` as tickets. Never reused. |
| Key | derived | `{ProjectKey}-D-{Number}`, e.g. `TKT-D-12`. Every kind, folders included, uses the same counter. Lookup is case-insensitive. |
| Kind | DocKind | Immutable |
| DiagramFormat | DiagramFormat? | Required if and only if Kind = `Diagram`. Immutable. |
| ParentId | uuid? | Null means the project root. Otherwise a non-deleted **Folder** in the same project. Pages and diagrams have no children. |
| Rank | text(128) | Fractional index within the parent (§6.6 algorithm). Folders, pages and diagrams are mixed in one manual order. Written only through the ranker. |
| Title | text(200) | Required and single line. Unique among non-deleted siblings, case-insensitively (`doc.title.duplicate`). A literal `/` is allowed; in a path it is written `\/`. |
| Content | text? | Copy of the latest version's content, for reads and search. Null for folders. Page: md(100 000). Mermaid: text(20 000). Canvas: text(2 000 000) with ≤ 10 000 elements. |
| SearchVector | tsvector | Generated. Title is weight A. Weight B is the content for pages and Mermaid, and the extracted text labels for Canvas. Title also gets a trigram index. |
| CurrentVersion | int | 0 for folders, otherwise ≥ 1 |
| CreatedAt/ById, UpdatedAt/ById | | Updated on any content save, rename or move. |
| DeletedAt/ById, DeletedRootId | …, uuid? | Soft delete. `DeletedRootId` groups a subtree that was deleted together. |
| RowVersion | xmin | |

**DocVersion** (immutable, never deleted)

| Field | Type | Constraints |
| --- | --- | --- |
| Id, NodeId | uuid | |
| Number | int | 1..n per node; unique with NodeId |
| Title, Content | | Snapshot at save time |
| ChangeNote | text(200)? | Optional "what changed" |
| AuthorId, Channel, CreatedAt | | |
| RestoredFrom | int? | Set when the version was created by "Restore version n" |

Versions are full snapshots with no deltas; PostgreSQL TOAST compresses them. There is no retention limit in v1.

**DocDraft**: a private, per-user unpublished edit.
- Fields: `NodeId`, `UserId` (primary key together), `BaseVersion int`, `Title`, `Content`, `UpdatedAt`. Same limits as `DocNode`.
- Visible only to its owner. Others see only presence (§1.8).
- Deleted on publish or discard. Kept otherwise, including when the node is deleted, so a restore brings it back.

**DocReference**: a derived index, rebuilt from the latest content on every publish.
- Fields: `SourceNodeId`, `TargetType`, `TargetId`. All three form the primary key.
- Holds ticket keys and doc keys found in the content of pages and Mermaid diagrams. Unknown keys are ignored.
- Cross-project references are allowed. Visibility is filtered when the index is read.

**Attachment** (additive change):
- `TicketId` becomes nullable and a new `DocNodeId uuid?` is added, with a check constraint that exactly one is set.
- Everything else from §4.8 and D-63 stays: same store, allow-list, 10 MiB limit, `/api/v1/attachments/{id}` URL and content sniffing.
- Limit: 200 per page. Delete is allowed for the uploader or an Owner.

**Limits**

| Limit | Value | Error code |
| --- | --- | --- |
| Tree depth (root children are depth 1) | 6 | `doc.tree.depth` |
| Children per folder | 500 | `doc.tree.folderFull` |
| Non-deleted nodes per project | 5 000 | `doc.project.limit` |

### 1.4 Tree rules
- **Create.** Folder, page or diagram, inside the root or a folder, at `Top`, at `Bottom` (the default), or before/after a sibling. A new page or diagram gets version 1 with the given content, possibly empty. Folders have no versions.
- **Rename.** Changes `Title`. It writes activity entry `doc.renamed` and creates **no** version, because the next version snapshots the title.
- **Move.** Within the project only: change parent and/or position. A folder moves with its subtree. Rejected cases:
  - moving a folder into its own subtree: `doc.tree.cycle`;
  - the moved subtree's depth would exceed 6: `doc.tree.depth`;
  - a sibling title clash at the target: `doc.title.duplicate` (the UI offers a rename).

  A move writes `doc.moved` and creates no version.
- **Duplicate** (page or diagram). Copies the latest content into a new node next to the original, titled "Copy of …" with " (2)" etc. added on a clash. The new node starts at version 1.
- **URLs.**
  - `/p/{PK}/docs` is the Docs home.
  - `/p/{PK}/docs/{DocKey}/{slug}` opens a doc. The slug comes from the title, is cosmetic and is ignored on lookup; a stale or missing slug is replaced in the address bar.
  - `/docs/{DocKey}` redirects.
  - `?v=5` shows a version and `/history?a=4&b=7` compares two.
  - Headings get stable anchors `#heading-slug`, with `-2`, `-3` added to duplicates.
- **Path addressing** (MCP and REST convenience). `Architecture/ADRs/0001 Use Postgres` resolves through the sibling-unique titles, case-insensitively. A key always works too.

### 1.5 Permissions (mapped to §5)

| Action | Owner/Admin | Member (public project: every signed-in user) | Viewer (private) | No access |
| --- | --- | --- | --- | --- |
| See tree, docs, versions, backlinks, attachments; search; export PDF/.md | Yes | Yes | Yes | 404 |
| Create, rename, move, duplicate; edit and publish; restore a version; upload images | Yes | Yes | No | 404 |
| Hold a draft or appear as "editing" | Yes | Yes | No | – |
| Delete a page or diagram | Yes | Only nodes they created | No | 404 |
| Delete a folder (whole subtree) | Yes | Only an **empty** folder they created (`doc.folder.notEmpty`) | No | 404 |
| Undo own delete within 10 min | Yes | Yes (the deleter) | – | – |
| Trash: list, restore anything | Yes | No | No | 404 |
| Delete an attachment | Yes | Own uploads | No | 404 |

Further rules:
- An **archived project** makes everything read-only. Read, search, history and export still work. Publish, draft save, upload, move and delete answer `409 project.archived`. Existing drafts are kept.
- Every read path is composed with `ReadableProjects()` and returns 404, never 403.
- References are filtered for the viewer:
  - A ticket or doc the viewer can't read renders as **plain text** with no title or status, and never appears in backlinks or the ticket's docs section.
  - The embed of an unreadable or deleted diagram renders the placeholder "Diagram not available". It shows neither the title nor the key's existence.
- PDF exports apply the same filters for the exporting user.
- The deletion rule mirrors the ticket and attachment rules (D-02, Q-05). Members can clean up their own mistakes, and Owners keep the destructive power over other people's work.

### 1.6 Page lifecycle
- **No draft or published state on the page itself.** A page always shows its latest published version.
- Unpublished work lives in the author's private **DocDraft**:
  - autosaved 1 s after the last change, on blur and before navigation;
  - never visible to others;
  - **Publish** (⌘S) creates a version.

  This is "drafts per edit", not a workflow state. It gives crash and device safety, a presence signal, and no half-typed text shown to readers.
- **Delete** follows D-82:
  - The delete is immediate. The node and, for a folder, its whole subtree get `DeletedAt` and a shared `DeletedRootId`.
  - An 8 s Undo toast follows.
  - `POST /docs/{key}/restore` works for the deleter within 10 minutes and for Owners at any time (from Trash).
  - Restore brings back the whole group to the original parent if it is alive, otherwise to the root. On a title clash the restored node gets " (restored)" appended.
  - Nothing is purged in v1.
- **Version history.**
  - The list shows: number, author, channel, time, change note, and "restored from vN".
  - Any version can be viewed rendered.
  - Diff between any two versions:
    - Pages and Mermaid: a line diff, unified or side-by-side, with word highlights inside changed lines. Computed on the client.
    - Canvas: the two versions rendered side by side; no structural diff in v1.
  - **Restore vN** creates a new version with vN's title and content and `RestoredFrom = N`, writes `doc.version.restored`, and loses nothing.

### 1.7 Concurrency (decided: optimistic, with drafts, presence and 3-way merge; Q-08 confirms "no real-time")
- Content writes carry `baseVersion`, the content version number the edit started from.
  - It is **required** whenever `content` is replaced (`doc.baseVersion.required`).
  - If stale, the server answers `409 doc.version.conflict` with `{ currentVersion, updatedBy, updatedAt }`.
  - Renames and moves don't need it.

  We use the content version and not `rowVersion` so that a rename or move doesn't fail an edit (the D-43 problem). Requiring it deviates from §2's "optional If-Match": a lost update on a long page is exactly the damage D-43 protects against.
- The web client handles a conflict like this:
  1. It runs a line-based 3-way merge of base, theirs and mine.
  2. A **clean merge** is published automatically, with a toast "Merged with Jane's changes (v8)".
  3. **Overlapping changes** open a conflict view with "Theirs (vN)" and "Mine" side by side and three buttons:
     - `Keep editing on latest` loads theirs into the editor with my text in a side panel to copy from;
     - `Overwrite with mine` publishes; theirs stays in history;
     - `Discard mine`.
- **Presence.** GET doc returns `editors: [{user, since}]`: other users whose draft of that doc changed in the last 10 minutes. The view and the editor show "Jane is editing" and refresh every 30 s while open.
- **MCP** has `edit_doc`, a find/replace that is applied atomically to the **latest** version. It needs no `baseVersion` and so composes with concurrent human edits. Full replacement through `update_doc` needs `baseVersion`.
- Why not locking: stale locks, and they block LLM agents.
- Why not real-time: a WebSocket and CRDT stack that changes the storage model; I-37 real-time is already LATER for boards. Contention in a small team is low, and history makes every overwrite recoverable. The drafts model does not block a future real-time upgrade.

### 1.8 Editor and viewer
- **Editor.**
  - Full-height split view: a monospace markdown source pane on the left and a live rendered preview on the right, with approximate scroll sync. The split view replaces the Write/Preview tabs for docs.
  - Toolbar: heading, bold, italic, link, ordered and unordered list, task list, code block, table template, callout, insert image, insert diagram (pick an existing one or create a new Mermaid or Canvas diagram), insert ticket link.
  - Title is edited inline above the body.
  - Status line: `Draft saved` / `Saving draft…` / `Couldn't save draft · Retry` / `Published v7`.
  - Optional change note field, shown when publishing.
- **Viewer.**
  - Shows the rendered page and a meta line: key, `v7`, "Edited by X, 2 h ago", path breadcrumb.
  - Actions: `Edit`, `History`, `Copy link`, `Export PDF`, `Download .md`, `…` (Move, Duplicate, Delete).
  - Right rail "On this page" lists h1–h3 headings with scroll-spy.
  - Footer panels: "Linked from" (backlinks) and "Tickets mentioned" (key, status icon, title).
  - If the user has their own draft, a banner: "You have unpublished changes from 10:42 · Continue editing · Discard". The tree shows a pencil dot on such docs.
- **Markdown rules.** Same flavour as §2 (CommonMark + GFM, `breaks: true`, raw HTML shown as text, sanitized), plus these extensions, implemented once in `renderMarkdown` and used by the screen and the PDF:
  1. Doc keys `\b[A-Z][A-Z0-9]{1,9}-D-\d+\b` autolink and show the current title on hover. `[text](TKT-D-12)` links with custom text.
  2. Ticket keys render as chips with a status icon, and the title on hover. Data comes from the `references` field of the GET, with no per-key calls.
  3. ```` ```mermaid ```` blocks render as diagrams.
  4. `![caption](TKT-D-7)` embeds a diagram doc: rendered read-only, with the caption and a link to open it.
  5. GFM alerts: `> [!NOTE]`, `TIP`, `IMPORTANT`, `WARNING`, `CAUTION`.
  6. Heading anchors.
  7. Code syntax highlighting. The library is chosen in the spike; tickets benefit too.
- **Linking helper.** Typing `[[` opens a doc picker: title search in readable projects, the current project first. Enter inserts `[Title](KEY)`. Typing `#` followed by a ticket key, or the toolbar button, opens the ticket picker.
- **Images.** Pasting or dropping an image uploads it as an attachment of the page and inserts `![name](/api/v1/attachments/{id})`, as D-63 does. Uploads stay attached when a draft is discarded and are listed in the page's attachments panel.
- **Mermaid security.** `securityLevel: 'strict'` and no click callbacks. A render error shows an inline error box with the parser message; the page still renders.
- **Canvas.**
  - Editor features: shapes, connectors and arrows bound to shapes, text, free draw, select/move/resize, zoom and pan.
  - Edits go through the same draft-and-publish flow.
  - Rendering follows the app theme on screen and is always light in PDF.
  - Element links accept only `http(s)://` and app-relative URLs; others are rejected (`doc.diagram.invalidSource`).
  - Embedded images or binary files are rejected in v1 (`doc.diagram.embeddedFiles`); the editor disables image insert with the tooltip "Images go in pages".
  - The server parses the source and extracts an **outline**: text labels plus connector relations such as `API → DB`. The outline feeds search and MCP.
- **Mermaid source** is not validated on the server in v1, because the renderer is JavaScript. The UI validates live and warns before publishing invalid source, but still allows it.

### 1.9 Links, backlinks, ticket integration
- References are parsed at publish into `DocReference`.
- Doc view: "Linked from" lists readable, non-deleted docs referencing this one, as key, title, path and updated time. "Tickets mentioned" lists readable tickets.
- Ticket view: a section "Docs mentioning this ticket", added via `provideTicketDetailSection`.
  - Shows readable, non-deleted docs, newest first, at most 20, then "and N more" linking to docs search `mentions=KEY`.
  - Hidden when empty.
  - MCP `get_ticket` gains `include: docs`.
- Deleted target doc: the link renders as `TKT-D-12 (deleted)`, struck through, for readers of that project; for others it is plain text.

### 1.10 Search
- **Quick jump (⌘K).**
  - Typing a doc key opens the doc.
  - For text, a "Docs" group shows the top 5 docs (title and path) under the top 10 tickets.
  - Recent docs appear in the palette's "recent" list.
- **Search page.**
  - A `Tickets | Docs` scope switch, kept in the URL.
  - Docs filters: projects, kind, folder (subtree), `mentions` (ticket key), updated range, and `text`.
  - Sort: `relevance` when there is text (`ts_rank`, top 100, no cursor) or `updated` (keyset cursor).
  - A result shows: key, kind icon, title, project, path, updated by/at, and a snippet. The snippet is **plain text plus highlight ranges**, never HTML.
- **Tree filter** (`/` on the Docs page): client-side title filter that keeps ancestors visible.
- Search covers the title, the latest content (pages and Mermaid) and Canvas labels. Deleted docs and unreadable projects are excluded. Drafts are never searched.
- Performance: p95 < 150 ms with 20 000 docs and 200 000 tickets.

### 1.11 PDF export
- **What can be exported:**
  - a single page, at the latest or any version (`?version=`);
  - a single diagram;
  - a folder, recursively, depth-first in tree order, deleted docs excluded.

  Rendering runs on the server through the **same renderer as the screen**: the SPA's print route in headless Chromium, with no second markdown implementation.
- **Single page or diagram.**
  - No cover.
  - First-page title block: title, key, `v7`, "Last edited by X on date", folder path.
  - A diagram is one figure scaled to fit, with automatic portrait or landscape orientation by aspect ratio.
- **Folder.**
  - Cover: project name and key, folder title and path, "N documents", "Exported by Name on date".
  - Then a table of contents, hierarchical as in the tree, with clickable entries and page numbers. If the spike proves page numbers infeasible, links-only is the accepted fallback.
  - Each document starts on a new page.
  - Links between docs in the export jump inside the PDF; other links point to the app URL.
- **Header** on every page except the cover: left `PK · Document title`, right the truncated folder path.
- **Footer**: left "Exported {date time} by {name}", centre `{DocKey} v{n}`, right "Page x of y". Docs of private projects add "Private project".
- Dates use the requester's time zone (`tz` parameter from the browser); MCP links use UTC.
- **Print styling.**
  - Always the light tokens, independent of the user's theme. White background; code blocks and table headers on a light grey.
  - A4 portrait, 18 mm margins.
  - Headings keep with the next block. No breaks inside figures, images, table rows, or code blocks under 30 lines.
  - Table headers repeat across pages. Long code lines wrap. Images use max-width 100%.
  - Links are coloured and underlined.
  - Mermaid and Canvas are embedded as vector graphics.
  - PDF bookmarks follow the headings and documents.
- **Limits.**
  - Folder export: at most 300 documents and 100 MB output (`doc.export.tooLarge`).
  - At most 2 renders run at once on the server; a queue of 10; beyond that `429 doc.export.busy` with `Retry-After`.
  - Timeout 120 s.
- **Targets:** single page p95 < 3 s; a 50-document folder < 30 s.
- Exports are logged in structured logs (user, doc, size). They write no activity entry.
- **Download .md**: the raw page markdown, `text/markdown`, attachment disposition.

### 1.12 Activity and audit
`ActivityEntry` gets `EntityType=Doc` with `ProjectId` set. Actions:
- `doc.created`
- `doc.updated`, recording the new version number as `NewValue`; content lives in versions, not in activity
- `doc.renamed`, with old and new title
- `doc.moved`, with old and new parent key or path
- `doc.deleted`, recording `DeletedRootId` and the subtree count
- `doc.restored`
- `doc.version.restored`
- `doc.attachment.added` and `doc.attachment.deleted`

The History panel merges versions and activity chronologically. Channel `Web`, `Api` or `Mcp` is shown.

### 1.13 MCP tools
Docs are referenced by `docKey` (`TKT-D-12`) or by `projectKey` + `path`. Outputs carry raw markdown. Every doc output includes: `key, kind, diagramFormat, title, path, parentKey, version, rowVersion, updatedAt, updatedBy, url`.

| Tool | Inputs | Output | Hints |
| --- | --- | --- | --- |
| `list_docs` | `projectKey`, optional `folder` (key/path), `depth` (default all), `kinds` | Flat tree in order, each item with `depth` | read |
| `get_doc` | `docKey` or `projectKey`+`path`, optional `version`, `include` (`backlinks`, `references`, `attachments`, `children`) | Page: `content` markdown plus `references` resolved (key, kind, title, status for tickets; unreadable ones omitted) and `embeds`. Diagram: `format`, `source`, and `outline` for Canvas. Folder: `children`. | read |
| `search_docs` | `text`, optional `projectKeys`, `kinds`, `folder`, `mentions`, `sort`, `limit`, `cursor` | Summaries with snippet | read |
| `get_doc_history` | `docKey`, `limit`, `cursor` | Versions and activity | read |
| `get_doc_export_link` | `docKey`, optional `version` | `{ url, expiresAt }`: a signed GET link valid 15 min, bound to the user and doc; access is re-checked on use | read |
| `create_folder` | `projectKey`, `title`, optional `parent`, `position`/`beforeKey`/`afterKey`, `idempotencyKey` | Folder | |
| `create_page` | as above plus `content`, `changeNote` | Page (v1) | |
| `create_diagram` | as above plus `format` (`Mermaid`/`Canvas`), `source` | Diagram (v1) | |
| `update_doc` | `docKey`, any of `title`, `content` (page) / `source` (diagram) (requires `baseVersion`), `changeNote` | Updated doc | |
| `edit_doc` | `docKey`, `edits: [{oldText, newText, replaceAll?}]` (1..50, applied in order, all or nothing, on the latest version), `changeNote` | Updated doc. Errors `doc.edit.noMatch` and `doc.edit.ambiguous`, with the hint "re-read with get_doc". | |
| `move_doc` | `docKey`, `parent` (key/path/`root`), position | Moved doc | |
| `delete_doc` | `docKey` | Confirmation (subtree count) | destructive |
| `restore_doc_version` | `docKey`, `version` | New version | |

Further MCP rules:
- `ReadOnly` PATs see the five read tools.
- Restoring deleted docs stays REST and UI only (D-82).
- Tool descriptions must:
  - list supported Mermaid types: `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`, `mindmap`;
  - recommend `edit_doc` for small changes to long pages;
  - say that Canvas source is the editor's native format and that Mermaid is preferred for LLM-authored diagrams.

### 1.14 REST outline (`/api/v1`)

| Method and path | Purpose |
| --- | --- |
| `GET /projects/{pk}/docs/tree` | Whole tree, unpaged (≤ 5 000): id, key, kind, format, title, parentKey, rank-ordered, version, updatedAt, `hasMyDraft` |
| `GET /projects/{pk}/docs/recent?limit=10` | Recently updated |
| `POST /projects/{pk}/docs` | Create (kind, title, parent, position, content/source, format). `Idempotency-Key`. |
| `GET /docs/{key}` (`?version=n`) | Doc + references + backlinks + editors + permissions |
| `PATCH /docs/{key}` | title / content / changeNote / `baseVersion` |
| `POST /docs/{key}/edits` | find/replace edits |
| `POST /docs/{key}/move` | parent + position |
| `POST /docs/{key}/duplicate` | |
| `DELETE /docs/{key}` · `POST /docs/{key}/restore` · `GET /projects/{pk}/docs/trash` | delete / undo / trash |
| `GET /docs/{key}/versions` · `GET /docs/{key}/versions/{n}` · `POST /docs/{key}/versions/{n}/restore` | history |
| `GET\|PUT\|DELETE /docs/{key}/draft` | my draft |
| `GET\|POST /docs/{key}/attachments` | page images |
| `GET /tickets/{key}/docs` | docs mentioning a ticket |
| `GET /docs/search?…` | search (format follows search-url-format.md) |
| `GET /docs/{key}/export.pdf` (`?version=&tz=`) · `GET /docs/{key}/export.md` · `POST /docs/{key}/export-link` | export |

### 1.15 Dashboard and home
- **Docs home** (`/p/{PK}/docs`, nothing selected): "Recently updated" (10 docs: title, path, who, when) and quick actions New page, New folder, New diagram.
- **Project dashboard**: a new widget, number 13, "Recent docs": the 5 latest docs plus a total doc count, linking to the Docs home. `get_project_stats` gains `recentDocs`.

### 1.16 Keyboard (Docs scope; registered via `ShortcutService`, shown in `?`)

| Keys | Action |
| --- | --- |
| `G` then `W` | Go to Docs (`D` is taken by Dashboard) |
| `N` / `Shift+N` / `Shift+D` | New page / folder / diagram in the current folder |
| `J`/`K`, `↑`/`↓`, `←`/`→`, `Enter` | Tree: navigate, collapse/expand, open |
| `/` | Filter the tree |
| `E` | Edit the doc |
| `⌘S` | Publish |
| `⌘↵` | Publish and close |
| `Esc` | Close the editor; the draft is kept |
| `F2` | Rename |
| `M` | Move to… (folder picker) |
| `H` | History |
| `Del` / `⌘⌫` | Delete with Undo |
| `⌘.` / `⌘⇧.` | Copy key / link |
| `[[` (in editor) | Doc link picker |

### 1.17 Empty states (design-system pattern: icon, title, one sentence, action plus Kbd)

| Where | Text and actions |
| --- | --- |
| Docs home, nothing yet | "No docs yet · Pages, folders and diagrams for this project live here." [New page `N`] [New folder] [New diagram] |
| Empty folder | "This folder is empty" + the same three actions |
| No search results | "No docs match" [Clear filters] |
| Trash | "Trash is empty" |
| History | Never empty (v1 always exists) |
| Backlinks | "No docs link here yet" |
| Ticket section | Hidden when empty |
| Viewer or archived project | The same text without action buttons; an archived project shows its read-only banner |

Loading uses skeletons for the tree rows and page anatomy, and stale-while-revalidate for the tree and recent lists (tag `project:KEY`).

---

## 2. Improvements triage

| ID | Improvement | Value | Size | Verdict |
| --- | --- | --- | --- | --- |
| – | Tree drag & drop + Move-to picker | Core of "folders" | S | **IN** |
| – | Duplicate page/diagram | Covers most template use | S | **IN** |
| – | "On this page" outline + heading anchors (ToC) | Long docs are navigable; shareable section links | S | **IN** |
| – | GFM callouts (`[!NOTE]`…) | Confluence info panels are heavily used; LLMs know the syntax | S | **IN** |
| – | Code syntax highlighting | Technical docs; tickets benefit | S | **IN** |
| – | Ticket chips with status (Jira-macro replacement) | Live status of referenced work | S | **IN** (from references) |
| – | Presence "X is editing" | Prevents most conflicts cheaply | S | **IN** |
| – | Trash (Owner restore of older deletes) | Folder delete has a large blast radius | S | **IN** |
| – | Recent docs (Docs home + dashboard widget) | Discovery | S | **IN** |
| – | Download page as .md | Free, LLM- and dev-friendly | XS | **IN** |
| I-82 | Page templates (built-in or per project) | Consistency of ADRs and meeting notes | S | LATER (Duplicate covers it) |
| I-83 | Page comments (footer) | Review discussions | M | **IN** (owner, Q-10): story D12 |
| I-84 | Inline comments on text ranges | Precise reviews | L | LATER |
| I-85 | @mentions in pages, with notification | Reuses TKT-8 | S | LATER (after TKT-7/8). Until then `@` stays plain text in docs. |
| I-86 | Watch page or folder + notifications on publish | Reuses TKT-6/7 | S | LATER (same epic) |
| I-87 | Labels on pages | Cross-folder grouping | S | LATER (folders + search cover it) |
| I-88 | Export to Word (.docx) | Some external recipients edit | M | LATER (PDF covers sharing) |
| I-89 | Confluence importer | Bring history over | L | **Not planned.** Claude-assisted copy of chosen pages over the Atlassian and Ticketing MCP servers instead (Q-09); a one-page playbook in `docs/mcp.md` is IN. |
| I-90 | Bulk markdown import (.md files / zip) and folder export as zip | Migration and backup | S | LATER |
| I-91 | Public, unauthenticated share links | Share with externals | M | LATER / probably never (exfiltration risk; PDF covers) |
| I-92 | Company-wide spaces across projects | Handbook and cross-team docs | L | LATER. v1 convention: a public "docs project" (Q-07). |
| I-93 | Docs-only project mode (hide ticket sections) | Makes the convention above tidy | S | LATER |
| I-94 | Personal favourites and recently viewed docs | Fast access | S | LATER (with project favourites) |
| I-95 | Page analytics (views, readers) | Vanity metrics | M | Probably never |
| I-96 | Per-page restrictions | Hide one page in a project | M | Probably never: use a private project |
| I-97 | Real-time co-editing | Simultaneous workshops | L | LATER (Q-08) |
| I-98 | Images inside Canvas diagrams | Screenshots on whiteboards | S–M | LATER |
| I-99 | Mermaid → Canvas conversion | Start visual from LLM output | S | LATER |
| I-100 | Diagram PNG/SVG download | Slides and chats | S | LATER |
| I-101 | Move docs between projects | Reorganisation | M | LATER |
| I-102 | Page owner, review date, "outdated" badge | Doc rot | S | LATER |
| I-103 | Create ticket from selected page text | Specs → tickets | S | LATER (MCP does it today) |
| I-104 | Server-side Mermaid validation for MCP writes | LLM learns about broken syntax | S | LATER (reuse the PDF renderer) |
| I-105 | Transclusion (include page in page) | Reuse snippets | M | Probably never |

---

## 3. Open questions

### Decided by me (recorded in D-97 onwards)
1. **Placement.** A sidebar sub-item "Docs" per D-83, not a header tab.
2. **Node model.** Three kinds in one tree (Folder, Page, Diagram). Pages have no children, which keeps folder semantics and folder export unambiguous.
3. **Keys.** `{PK}-D-{n}` for every node from one per-project counter. The key is the canonical URL part and the slug is cosmetic, which is rename-safe with no slug table. The format can't collide with the ticket regex.
4. **Sibling-unique titles.** They make path addressing deterministic for LLMs; Confluence has the same rule per space.
5. **No draft or published page state.** Private server drafts plus explicit Publish creating a version, and unlimited full-snapshot history. This is simpler than a workflow and still safe.
6. **Concurrency.** Optimistic with a required `baseVersion` on content replacement, client-side 3-way merge, presence, and MCP `edit_doc` (§1.7).
7. **Deletion.** Owner, or a Member on their own nodes (a folder only when empty). Undo for 10 minutes, Trash for Owners, no purge. Consistent with D-02 and Q-05.
8. **Rename and move create no version**; they are activity only.
9. **Embeds** use standard image syntax with a doc key. It degrades to a readable reference in any markdown tool and in LLM context.
10. **One renderer for screen and PDF.** PDF always light, A4. Exports go to logs, not activity.
11. **Attachments** are generalized with a nullable owner pair, not a second attachment system.
12. **Canvas v1.** No embedded images, link schemes sanitized, the outline extracted on the server.
13. **Cross-project references and embeds are allowed** and filtered per viewer. A leak shows as plain text, never a title.
14. **Mentions in docs** wait for TKT-8. Reusing the shared editor is fine, but notifying needs TKT-7.

### Needs the owner

**Q-06: Diagram approach.**
- A: Mermaid only (code-first; cheapest; no free drawing).
- B: Visual editor only (no text format for LLMs or diffs).
- C: Both: Mermaid in pages and as diagram docs, plus Canvas docs for shapes, arrows and free drawing.

*Recommendation: C.* The owner explicitly asked for free drawing, and Claude Code needs a text format. Canvas adds about 8 points over A.

**Q-07: Company-wide docs.**
- A: Per-project only. Shared material lives in a public project, e.g. `DOCS` or `HANDBOOK`, that everyone can read and edit (D-02).
- B: A new "Spaces" concept detached from projects (L: new permission model).
- C: One global docs area for everyone.

*Recommendation: A now. Hiding the ticket sections for such projects (I-93) is a small follow-up, and real spaces (I-92) come only if A proves awkward.*

**Q-08: Co-editing.**
- A: Optimistic + private drafts + "X is editing" + auto-merge (this spec).
- B: Real-time co-editing (CRDT + WebSockets; roughly +13–20 points and a new infrastructure piece; LLM edits must also go through it).
- C: Page locks.

*Recommendation: A.* A small team, low contention, and history makes overwrites recoverable.

**Q-09: Confluence content.**
- A: No importer. Teams copy the pages worth keeping, optionally with Claude Code reading Confluence over the Atlassian MCP and writing through `create_page`.
- B: A built-in importer that converts storage format and macros (L, lossy).
- C: Bulk markdown import (I-90, S).

*Recommendation: A*, consistent with Q-01 "no Jira migration".

**Q-10: Page comments in this epic?**
- A: No. Next epic, "Docs collaboration" (comments, watch, mentions on docs), built on TKT-5.
- B: Footer comments now (+5 points) but without notifications.

*Recommendation: A.* Comments without notifications go unread, and TKT-5 is in flight.

### Owner answers (2026-10-27)

| Question | Answer |
| --- | --- |
| Q-06 Diagram approach | **C — both**: Mermaid (inline and as diagram docs) plus Canvas docs for shapes, arrows and free drawing. |
| Q-07 Company-wide docs | **A — per project**; shared material lives in a public project. |
| Q-08 Co-editing | **A — optimistic**: private drafts, presence, 3-way merge, conflict view. |
| Q-09 Confluence content | Decided by the orchestrator, consistent with Q-01: **A — no importer**; a Claude-assisted copy playbook in `docs/mcp.md`. |
| Q-10 Page comments | **B — in this epic** (overrides the recommendation): footer comments ship with Docs as story D12. Comment notifications hook into TKT-7 when it is on `main`; watching docs and @mentions in docs stay in the follow-up "Docs collaboration" epic (I-85, I-86). |

---

## 4. Breakdown (delivery order)

### EPIC: Docs: project documentation with diagrams and PDF export (label `docs`, version 2.x)

**Goal:** each project has a Docs section with folders, markdown pages, Mermaid and Canvas diagrams, version history, links to tickets, search and PDF export. All of it is usable from Claude Code over MCP.

**Out of scope:** comments, watchers and mentions on docs; spaces; real-time; importers; Word export (ideas I-82..I-105).

**Definition of done for every child:**
- Spec §12, glossary, decisions D-97+ and `docs/mcp.md` updated.
- Additive migrations only (ADR 0006).
- Integration tests including permission and leak paths, copying the leak-guard test.
- Light and dark theme checked, with screenshots on the ticket.
- Initial JS bundle grows by less than 10 KB gzipped. Mermaid, the canvas editor and the diff library are lazy chunks.

---

#### D1 · Spike: diagram editor, Mermaid and PDF pipeline · Spike · 5 pts · deps: none
Timebox 4 days. It turns the researcher's shortlist into a working proof.

AC:
- [ ] A throwaway branch demonstrates, in the Angular app, a lazy-loaded Canvas editor (Excalidraw or draw.io) that:
  - creates shapes, a bound arrow, text and free draw;
  - saves and loads its native source;
  - renders read-only for an embed;
  - follows the app's light and dark theme.
- [ ] A server-side extractor produces an outline (labels + `A → B` relations) from that source. Unit tests run on 3 sample scenes.
- [ ] Mermaid renders with `securityLevel: 'strict'`. A malicious sample (click callback, `javascript:` link, HTML label) renders inert.
- [ ] Headless Chromium (or Gotenberg) renders the SPA print route of one page, with Mermaid, Canvas, a table and code, to A4 PDF:
  - page x/y footer and header;
  - always light;
  - vector diagrams;
  - bookmarks.

  The spike decides whether ToC page numbers are feasible (a two-pass render or Paged.js) and measures timings for 1 and 50 documents.
- [ ] The renderer's isolation is documented: no outbound network except the API, an auth model for the print route (short-lived render token), memory and CPU limits in compose.
- [ ] Output: ADR 0013 (diagram editor + PDF pipeline), chosen libraries with exact versions and licences, bundle-size numbers, and the decision on the `Canvas` source format.

#### D2 · Docs backend core: tree, pages, folders (REST + MCP) · Technical · 8 pts · deps: none (can run alongside D1)
AC:
- [ ] Additive migration:
  - `doc_node`, `doc_version`, `doc_draft`, `doc_reference`;
  - `project.next_doc_number`;
  - `attachment.ticket_id` nullable plus `doc_node_id` with an exactly-one check constraint;
  - partial unique index on (project, parent, lower(title)) where not deleted;
  - title trigram index and generated `search_vector` with a GIN index.
- [ ] Use cases, one handler each, exposed as REST (§1.14) and MCP (`list_docs`, `get_doc`, `create_folder`, `create_page`, `update_doc`, `edit_doc`, `move_doc`, `delete_doc`): create, get (by key or path), tree, recent, rename/update, edits, move, duplicate, delete, restore, trash, and the draft get/put/delete.
- [ ] Keys `{PK}-D-{n}` are allocated race-free. A test with 20 parallel creates gives no duplicates.
- [ ] Rules are enforced with the stable codes: depth 6, cycle, folder 500, project 5 000, sibling title, content limits, `baseVersion` required/stale (`doc.version.conflict` carrying current version, author and time), `edit_doc` noMatch/ambiguous and all-or-nothing.
- [ ] Ranking goes through a generalized ranker inside `InTransactionAsync`; rebalancing is tested. No hand-written ranks.
- [ ] Permission matrix §1.5 covered row by row, including:
  - public project non-member can write;
  - Viewer is read-only;
  - Member deletes own pages but not others' or a non-empty folder;
  - archived project → `409 project.archived`;
  - private → 404.
- [ ] Leak tests: tree, get by key, get by path, recent, trash and MCP give an outsider of a private project nothing, and the 404 bodies are identical to "doesn't exist".
- [ ] Undo and restore: the deleter within 10 minutes, Owners any time; a subtree is restored as one group; a title clash gets " (restored)".
- [ ] Activity entries (§1.12) carry the channel.
- [ ] `ReadOnly` PATs see only the read tools.
- [ ] Performance: tree p95 < 150 ms and publish p95 < 250 ms with 5 000 nodes and 100 KB pages, as a performance test.

#### D3 · Docs section: tree navigation and management · User story · 5 pts · deps: D2
*As a project member I want a Docs section with a folder tree so that I can organise documentation.*

AC:
- [ ] A sidebar sub-item "Docs" appears for every readable project, plus `G W`. Routes, view ids and the title strategy follow §1.1 and §1.4. `/docs/{key}` redirects, and a stale slug is replaced.
- [ ] Tree panel:
  - expand/collapse (state persisted per project);
  - drag & drop reorder and reparent, with drop indicators, optimistic and rolled back with a toast on error;
  - "Move to…" picker (`M`);
  - inline create for folder, page and diagram (`N`, `Shift+N`, `Shift+D`) and inline rename (`F2`);
  - duplicate;
  - delete with an 8 s Undo;
  - keyboard navigation (§1.16);
  - `/` filter.
- [ ] Trash view for Owners with restore. Others don't see the entry.
- [ ] Docs home shows "Recently updated" and the empty states from §1.17. Viewers and archived projects see no write controls.
- [ ] Skeletons for the tree, and stale-while-revalidate (revisiting shows the cached tree within 50 ms).
- [ ] Vitest covers the tree store: move validation mirrors the server, plus optimistic rollback. Playwright covers creating a folder, creating a page, dragging it into the folder, renaming, deleting and undoing.
- [ ] A tree with 2 000 nodes stays smooth: it uses virtual scroll, and expanding a folder paints in under 100 ms.

#### D4 · Write and read markdown pages · User story · 8 pts · deps: D2, D3
*As a member I want to write pages in markdown with images and publish versions without losing work.*

AC:
- [ ] Viewer per §1.8: rendered page, meta line, "On this page" rail with scroll-spy, heading anchors (copy link on hover), callouts, code highlighting, and the attachments panel.
- [ ] Editor per §1.8: split pane with live preview and toolbar; title inline; change note; `E`, `⌘S`, `⌘↵`, `Esc`.
- [ ] Drafts:
  - autosaved 1 s after the last change, on blur and before navigation;
  - the status line shows the states from §1.8;
  - reopening shows the "unpublished changes" banner, and Discard works;
  - another user never receives my draft (API test).
- [ ] Presence: user B sees "A is editing" within 30 s of A typing, and it disappears 10 minutes after A's last draft change.
- [ ] Conflict:
  - Non-overlapping concurrent edits are auto-merged and published, with a toast.
  - Overlapping edits show the conflict view with its 3 actions (§1.7).
  - Vitest covers the merge on 10 fixtures. Playwright uses two browser contexts.
- [ ] Pasting or dropping an image uploads it to the page (limit 200, 10 MiB, D-63 checks) and inserts the embed. Download authorization follows the page's project; leak test.
- [ ] Download `.md` works.
- [ ] A 100 000-character page renders in under 500 ms, and typing in the editor stays under 16 ms per keystroke (measured).
- [ ] Light and dark checked.

#### D5 · Version history, diff and restore · User story · 3 pts · deps: D4
AC:
- [ ] The History view (`H`) lists versions merged with activity. Each version shows author, channel, time, change note and "restored from".
- [ ] Viewing any version rendered (`?v=n`) shows a banner "You are viewing v3 of 7 · Back to latest".
- [ ] Comparing any two versions shows a unified or side-by-side line diff with word highlights. Title changes are shown. Diffing two 100 KB versions takes under 300 ms.
- [ ] "Restore this version" (writers only) creates a new version with `RestoredFrom`; Viewers and archived projects don't see it.
- [ ] MCP `get_doc_history`, `get_doc` with `version`, and `restore_doc_version`, with integration tests.

#### D6 · Links, backlinks and ticket mentions · User story · 5 pts · deps: D4
AC:
- [ ] Publish rebuilds `doc_reference` from ticket keys, doc keys, `[text](KEY)` and embeds. Keys inside code spans and blocks are ignored, as the renderer does.
- [ ] The renderer autolinks doc keys and renders ticket chips with a status icon, using `references` from the GET with no extra requests. `[[` opens the doc picker.
- [ ] Doc view shows "Linked from" and "Tickets mentioned". The ticket view's "Docs mentioning this ticket" section (via `provideTicketDetailSection`) is hidden when empty, shows at most 20 entries, then "and N more".
- [ ] Leak tests:
  1. A private-project page mentioning a public ticket is invisible in that ticket's section to outsiders.
  2. A public page mentioning a private ticket renders it as plain text, with no title or status, for outsiders, and `get_doc.references` omits it.
  3. A deleted source doc drops out of backlinks.
  4. An embed of an unreadable diagram shows "Diagram not available".
- [ ] MCP `get_ticket` gains `include: docs`. `get_doc` returns resolved `references`, `embeds` and `backlinks`.

#### D7 · Mermaid diagrams (inline and diagram documents) · User story · 3 pts · deps: D1, D4
AC:
- [ ] ```` ```mermaid ```` blocks render in pages and in ticket descriptions and comments (shared renderer), lazily when scrolled into view. A syntax error shows an inline error box.
- [ ] A Mermaid diagram document has its own view (rendered, zoom/fit) and an editor with live preview and draft/publish/history like a page.
- [ ] `![caption](KEY)` embeds a diagram document in a page.
- [ ] The theme follows light/dark on screen. Security samples from D1 are inert (unit test).
- [ ] MCP `create_diagram` (`format: Mermaid`) and `update_doc`/`edit_doc` on diagrams. Tool descriptions list the supported diagram types. An LLM-written flowchart created over MCP renders in the UI (Playwright seeds through the API).
- [ ] One diagram renders in under 1 s. A page with 10 diagrams has no layout shift (reserved height).

#### D8 · Canvas diagrams: shapes, arrows and free drawing · User story · 8 pts · deps: D1, D4, D7
AC:
- [ ] "New diagram → Canvas" opens the chosen editor (lazy chunk): shapes, bound arrows, text, free draw, zoom/pan, undo/redo.
- [ ] Same draft, publish, presence, conflict and history flow as pages. The conflict view offers "Overwrite with mine" or "Discard mine"; there is no textual merge. History compares two versions rendered side by side.
- [ ] Server validation: size and element limits, allowed link schemes, no embedded files (`doc.diagram.embeddedFiles`); image insert is disabled in the editor.
- [ ] The outline is extracted on publish. Canvas labels are searchable. `get_doc` returns `source` and `outline`; a scene with "API" → "DB" returns `API → DB`.
- [ ] Embedding in pages renders a read-only, fit-to-width preview that is clickable to open.
- [ ] Light and dark on screen; the read-only render is checked in both.
- [ ] Opening a 2 000-element canvas takes under 1.5 s.

#### D9 · Docs search · User story · 5 pts · deps: D2 (UI after D3)
AC:
- [ ] `GET /docs/search` and MCP `search_docs` support the filters, sorts and snippet format from §1.10. Relevance mode returns at most 100. The `updated` sort uses keyset cursors.
- [ ] ⌘K: a doc key opens the doc. Text shows a "Docs" group (top 5) below tickets, debounced 120 ms as today.
- [ ] The search page gets a `Tickets | Docs` scope switch with state in the URL.
- [ ] Leak tests: private docs never appear (search, quick jump, MCP), drafts are never matched, and deleted docs are excluded.
- [ ] Snippets are plain text plus ranges. An XSS sample in content is not executed.
- [ ] p95 < 150 ms with 20 000 docs and 200 000 tickets, as a performance test.

#### D10 · PDF export: page, diagram, folder · User story · 8 pts · deps: D1, D4, D7, D8
AC:
- [ ] `Export PDF` exists on pages, diagrams (any version) and folders. `GET /docs/{key}/export.pdf` and MCP `get_doc_export_link` (signed link, 15 min, bound to the user, access re-checked on use; an expired or foreign link gives 404).
- [ ] Content, cover, ToC, header, footer and print styling as in §1.11. The PDF is light even when the user exports from dark mode (visual check on a fixture).
- [ ] Folder export follows tree order, excludes deleted docs, and makes internal links jump inside the PDF.
- [ ] The renderer applies the exporter's permissions: an embedded diagram or mentioned ticket from a project the exporter can't read appears as the placeholder or plain text (leak test on the PDF text layer).
- [ ] Limits and errors: `doc.export.tooLarge`, `429 doc.export.busy` with `Retry-After`, 120 s timeout.
- [ ] A Viewer can export, and an archived project can export.
- [ ] Single page p95 < 3 s; a 50-document folder < 30 s on the reference VM.
- [ ] The renderer container is added to docker compose with health check, resource limits and no egress; the backup docs are unchanged.

#### D11 · Recent docs on the dashboard, demo data and docs · User story · 2 pts · deps: D3 (finalised after D10)
AC:
- [ ] Dashboard widget "Recent docs" (5 latest plus total, linking to the Docs home), with an empty state. `get_project_stats.recentDocs` uses the readability filter.
- [ ] The demo seeder (through use cases, D-85) creates a small docs tree per demo project: folders, 4 pages with callouts, a table, ticket mentions, one Mermaid diagram and one Canvas diagram embedded in a page.
- [ ] `docs/mcp.md` gains a "Docs from Claude Code" section with example prompts and the Confluence copy playbook (Q-09 A). README screenshots of Docs in light and dark.
- [ ] Spec §12, glossary terms (Doc, Folder, Page, Diagram, Canvas, Draft, Publish, Doc key, Backlink) and the decisions D-97+ are merged.

#### D12 · Page comments · User story · 5 pts · deps: D4 (notifications part: TKT-7)
*As a reader I want to discuss a page in comments below it, so that review feedback stays next to the document instead of in chat.*

AC:
- [ ] Footer comment thread on pages and diagram docs (not folders), oldest first, markdown with the shared renderer (ticket and doc keys autolink); same rules as ticket comments (spec §6.9): edit and delete own, Owners delete any, "edited" marker, deleted comments leave a placeholder, the previous body goes to activity.
- [ ] Permissions per §1.5: readers see comments, writers add them; archived projects are read-only; private-project leak tests (REST, MCP, search snippets never include comments).
- [ ] Comment counts in the doc meta line and the tree tooltip; the History panel shows comment activity.
- [ ] Deleting a doc keeps its comments with it (restored together); versions don't affect comments.
- [ ] REST `GET|POST /docs/{key}/comments`, `PATCH|DELETE /docs/comments/{id}`; MCP `list_doc_comments`, `add_doc_comment`, `update_doc_comment`, `delete_doc_comment` (destructive hint).
- [ ] If TKT-7 (in-app notifications) is on `main` when this story starts: the doc's author and earlier commenters get a notification for new comments (never the actor). Otherwise a follow-up ticket is created. Watching docs and @mentions in docs stay in the "Docs collaboration" follow-up (I-85, I-86).
- [ ] Light and dark checked; Playwright: add, edit, delete a comment; Vitest for the comment store.

**Total: 65 points**, Spike + 11 stories. Critical path: D1 → D7 → D8 → D10. D2, D3, D4, D5, D6, D9 and D12 can start before the spike finishes.

## 5. Reconciliation with the technical research

[docs-and-diagrams.md](../research/docs-and-diagrams.md) verified the libraries. Where it and this spec differ, the tickets say:

| Topic | Research | Decision for the tickets |
| --- | --- | --- |
| Canvas editor | Excalidraw 0.18.1 (MIT) as a lazy React 19 island; tldraw rejected (license key + watermark); draw.io kept as a later option | **Excalidraw.** Store the native JSON plus an SVG snapshot on every publish; pages and PDFs embed the SVG. Self-host assets and fonts, `aiEnabled={false}`. **D1 outcome (TKT-11, D-99, ADR 0013):** the island is `tk-canvas-editor` in `shared/diagrams/canvas`. `wasm-unsafe-eval` is not enough (font subsetting needs eval), so the page CSP stays unchanged and a worker-only CSP on hashed scripts lets subsetting run. Dark embeds CSS-invert the light snapshot. |
| Mermaid | 12.2.0, lazy, `layout: "dagre"` (ELK default is 670 KB gz) | Adopted as stated. |
| Page editor | CodeMirror 6 + live preview, slash commands, `[[` completion, paste upload; WYSIWYG later | Adopted: matches the split-pane editor of §1.8. |
| PDF | Gotenberg 8.39 (MIT) Chromium sidecar on an `internal` network; API posts a self-contained HTML bundle rendered with Markdig | **Gotenberg sidecar adopted.** **D1 outcome (D-100, ADR 0013):** neither the print route nor Markdig. The API posts an offline **print bundle** built from the SPA's own `renderMarkdown` and Mermaid renderer, with the data already authorised for the exporter. One renderer, no callback from the renderer. Measured: one page 1.3–2.5 s, 50 documents 9–12 s warm. |
| PDF ToC page numbers | Not feasible (Chromium; Paged.js unmaintained) | Linked contents page + PDF bookmarks + `Page X of Y` footers — the accepted fallback in §1.11. Confirmed in D1: hierarchical bookmarks come from `generateDocumentOutline`. Footers are per export, so a folder export shows the folder key in the footer centre (D-101). |
| Attachments | Separate `doc_attachments` table on the existing store | D2 decides between that and the nullable owner pair of §1.3, recorded as a decision. |
| Version storage | Full copies, lz4 TOAST compression | Adopted. |
