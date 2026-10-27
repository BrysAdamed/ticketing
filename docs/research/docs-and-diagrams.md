# Docs area: diagrams, PDF export, editor and storage (verified 2026-10-27)

Research for a per-project **Docs** area that replaces Confluence: folders and markdown pages, diagrams and a whiteboard, PDF export of any page or folder, readable and writable by Claude Code over `/mcp`.

Every version and license below was checked on 2026-10-27 against the npm registry (`npm view`), NuGet, PyPI, Docker Hub, the license file in the package tarball or GitHub repo, or the vendor's docs. Bundle sizes were measured, not copied: each library was bundled with esbuild 0.28.2 (`--bundle --minify --splitting --format=esm`), and the figures are `gzip -9` totals of the chunks loaded for the stated scenario. Angular's build (also esbuild) will land within a few percent.

## 0. Decisions and red flags

**Recommendation**

| Area | Pick | Why, in one line |
|---|---|---|
| LLM-authored diagrams | **Mermaid 12** fenced code blocks in page markdown, rendered client-side, lazy | Plain text Claude already writes well, diffs line by line, MIT, no server |
| Visual editor (shapes, arrows, free drawing) | **Excalidraw 0.18.1** as a lazy React island, one "whiteboard" node kind | Covers both whiteboard and box-and-arrow diagrams, MIT, no extra container, dark mode built in |
| Formal diagrams (BPMN, UML, network stencils) | Deferred: **draw.io** (`jgraph/drawio`, Apache-2.0) as a second node kind if users ask | Strongest diagram editor, but a 380 MB Tomcat container and an iframe |
| PDF | **Gotenberg 8.39 `-chromium` image** (MIT) as an internal sidecar; API builds a self-contained HTML bundle | Real Chromium rendering (tables, code, Mermaid, SVG), no network access needed, hardening flags built in |
| Page editor (v1) | **CodeMirror 6** markdown source editor with live preview pane, slash commands, `[[` page-link and ticket-key completion, paste upload | Keeps the markdown byte-for-byte, so Claude's edits and human edits diff cleanly |
| Page editor (later) | Optional Milkdown Crepe WYSIWYG mode if non-technical users push back | MIT, but it re-serializes markdown |
| Server-side markdown | **Markdig 1.5.0** (BSD-2-Clause) on save | One parse gives plain text for search, headings for the outline, links for backlinks, and HTML for PDF |
| Storage | `doc_nodes` tree + full-copy `doc_page_versions` (lz4 TOAST) + `doc_links` + stored tsvector | Same patterns as tickets; no diff storage needed at our sizes |

**Red flags**

| # | Finding | Impact | Action |
|---|---|---|---|
| F1 | **tldraw is not usable.** `tldraw@5.5.2` is under the "tldraw license": production use needs a license key from a commercial agreement, the SDK enforces a watermark, and there is no free tier for a company our size (only a 100-day trial and a non-commercial hobby license). | Paid, key-gated, vendor lock. | Rejected. |
| F2 | **QuestPDF needs a paid license.** The Community license covers businesses with annual gross revenue under USD 1M; Adamed is over. It is also a C# layout DSL, not an HTML/markdown renderer. | Not free, wrong tool. | Rejected. |
| F3 | **Gotenberg is MIT, not Apache-2.0** (repo `LICENSE`). Both are fine. Its bundled PDF tools (qpdf, pdfcpu, pdftk, exiftool) only matter if we call the `pdfengines` routes; pdftk is GPL but runs as a separate process inside an unmodified image we do not redistribute. | None for internal use. | Use the `8.39.0-chromium` variant (no LibreOffice). |
| F4 | **Mermaid 12 made ELK the default layout.** A flowchart with default config pulls the ELK chunk: **670 KB gz** versus **233 KB gz** with `layout: 'dagre'`. It also re-lays out and recolours existing diagrams. | 3x the bytes per page with a flowchart. | `mermaid.initialize({ layout: 'dagre', look: 'classic', ... })`. Allow ELK per diagram via front-matter. |
| F5 | **Excalidraw fetches assets from `esm.sh` by default** (`ASSETS_FALLBACK_URL`), and the bundle contains URLs for its AI backend (`oss-ai.excalidraw.com`) and share-link backend (`json.excalidraw.com`). | Fonts fail on an offline VM; data could leave the network. | Set `window.EXCALIDRAW_ASSET_PATH`, copy `dist/prod/fonts` into the app, pass `aiEnabled={false}`, do not pass `onExportToBackend`. Our CSP `connect-src 'self'` already blocks the rest. |
| F6 | **Excalidraw npm releases are slow.** `0.18.0` was 2025-03-10, `0.18.1` was 2026-04-20. The repo is very active (pushed today, 134k stars), but fixes reach npm rarely. | Bug fixes may wait a year. | Pin exactly; wrap behind our own component so swapping to draw.io stays possible. |
| F7 | **Excalidraw's SVG export subsets fonts with WebAssembly** (harfbuzz, the 742 KB gz lazy chunk) in a module worker. Our CSP has `script-src 'self'`, which blocks `WebAssembly.compile`. | SVG snapshots may fail or ship unsubsetted fonts. | Add `'wasm-unsafe-eval'` to `script-src` (allows Wasm only, not JS `eval`). Verify in the spike (section 8). |
| F8 | **Paged.js is stale** (`pagedjs@0.4.3`, npm 2024-10). Chromium does not implement `target-counter()`, so a ToC with page numbers needs it or a second pass. | No page numbers in the folder ToC. | v1: linked ToC + PDF bookmarks (`generateDocumentOutline`) + "page X of Y" footer. Revisit if users ask for printed page numbers. |
| F9 | **CodeMirror moved off GitHub.** `codemirror/dev` is archived; packages now point at `code.haverbeke.berlin`. Releases continue (`@codemirror/view@6.43.15`, 2026-10-19), still MIT. | Issue tracker location only. | None. Note it for Renovate changelog links. |
| F10 | **Tiptap's pricing page lists "Markdown import/export" as a paid platform feature**, while `@tiptap/markdown@3.32.0` on npm is MIT. Collaboration, comments, history and AI are paid. | License ambiguity. | Not chosen; ask Tiptap in writing if it is ever reconsidered. |
| F11 | **Kroki** (MIT) bundles PlantUML, which is GPL by default; the `yuzutech/kroki` image is 1.19 GB. | Large image for diagram types Mermaid mostly covers. | Deferred. |

No license keys, no telemetry, no "powered by" requirement in the recommended set. All npm additions are MIT or BSD and pass the existing CI license allow-list.

---

## 1. Diagram and whiteboard editors

### 1.1 Versions and licenses

| Candidate | Package / image | Version (date) | License | Maintenance |
|---|---|---|---|---|
| Excalidraw | `@excalidraw/excalidraw` | 0.18.1 (2026-04-20) | MIT | Repo active daily; npm cadence slow (F6). Peers: React 17/18/19 |
| React (for Excalidraw) | `react`, `react-dom` | 19.3.1 | MIT | |
| Mermaid → Excalidraw | `@excalidraw/mermaid-to-excalidraw` | 2.3.0 (bundled 2.2.2 inside Excalidraw) | MIT | |
| tldraw | `tldraw` | 5.5.2 (2026-10-26) | tldraw license, key required (F1) | Active |
| draw.io | `jgraph/drawio` image | 32.6.1 (2026-10-23) | Apache-2.0 | Weekly releases |
| Mermaid | `mermaid` | 12.2.0 (2026-10-13) | MIT | 12.0 breaking release 2026-09-10 (F4) |
| Konva | `konva` | 10.9.0 | MIT | Canvas library, not an editor |
| Fabric | `fabric` | 7.4.0 (2026-05) | MIT | Canvas library, not an editor |
| Kroki | `yuzutech/kroki` | 0.34.0 | MIT (PlantUML inside is GPL by default) | Active |

### 1.2 Comparison

| | Excalidraw | draw.io embed | Mermaid in markdown | tldraw | Konva/Fabric custom | Kroki / PlantUML |
|---|---|---|---|---|---|---|
| Free drawing | Yes (pen, perfect-freehand) | Basic freehand | No | Yes | Build it | No |
| Shapes, arrows, bound connectors | Yes, arrows bind to shapes and follow them | Best in class: orthogonal routing, waypoints, stencil libraries (UML, BPMN, AWS, Azure, network) | Auto-layout only | Yes | Build it | Auto-layout only |
| Text-to-diagram for LLMs | Skeleton API `convertToExcalidrawElements` (minimal JSON) and Mermaid import built in | LLMs can write mxGraph XML; editor imports Mermaid and CSV | **Native**: the source is the diagram | Yes | No | Native (PlantUML, D2, Graphviz...) |
| Storage format | JSON scene (verbose: `seed`, `version`, `versionNonce` per element) | XML (`mxfile`); set `compressXml:false` to keep it readable | Plain text in the page | JSON | Our own JSON | Plain text |
| Diffable by humans / LLM | Fair (noisy fields) | Fair (verbose XML) | **Good** | Fair | Depends | Good |
| SVG / PNG export | Client-side `exportToSvg` / `exportToBlob`; fonts inlined by default | `export` action: `svg`, `xmlsvg` (SVG with the XML embedded), `png` | `mermaid.render()` returns SVG | Yes | Build it | Server returns SVG/PNG |
| Accessibility | Weak: canvas, keyboard shortcuts but little screen-reader output | Partial: SVG DOM, keyboard navigation | Good: SVG plus `accTitle` / `accDescr` | Weak (canvas) | Build it | Image only |
| Dark mode | `theme="dark"` prop | `ui` / `dark=auto` URL params | `theme: 'dark'` or `base` + `themeVariables` | Yes | Build it | No |
| Runs offline on the VM | Yes, after asset path fix (F5) | Yes (`?offline=1`, no OAuth vars set) | Yes | Needs key check | Yes | Yes (1.19 GB image) |
| Initial cost | **436 KB gz** JS (incl. 67 KB React) + 22 KB CSS, lazy | 0 KB in our bundle; ~380 MB container, multi-MB iframe load (cached) | **181 KB gz** core; **233 KB** with a dagre flowchart; 322 KB for six common types | n/a | Konva ~50-60 KB, but months of work | 0 KB; container |
| Angular integration effort | Medium: React island, lazy CSS, asset copy (snippets in 7.1) | Medium: iframe + postMessage + nginx location (7.4) | Low: post-process `language-mermaid` blocks (7.3) | Medium + license | High | Low (img src) but needs a proxy endpoint |

Full lazy totals for reference: Excalidraw's chunks add up to 2.5 MB gz (most of it the font-subsetting Wasm and mermaid-to-excalidraw, loaded only when used); fonts are 14 MB on disk, of which 13 MB is the Xiaolai CJK font fetched per glyph range. Mermaid with every diagram type is 1.4 MB gz.

### 1.3 Notes per candidate

**Excalidraw.** The editor is a React component. It needs a container with a non-zero height and the CSS file `@excalidraw/excalidraw/index.css`. Images dropped onto a board become `BinaryFiles` data URLs inside the scene JSON, which bloats it; map them to our attachment store with `generateIdForFile` and load them through `addFiles`. Replace the default main menu (`<MainMenu>` children) to drop the socials and Excalidraw+ links. The library dialog links to `libraries.excalidraw.com`; hide it or accept that it will not load offline. `@excalidraw/mermaid-to-excalidraw` lets a user turn a Mermaid block into an editable board, which is the bridge between Claude-written diagrams and hand editing.

**tldraw.** Technically good. Licensing ends the discussion (F1).

**draw.io.** The self-hosted image is the same web app as diagrams.net. It can run under a sub-path (`DRAWIO_SERVER_URL=https://host/drawio/`), so nginx can proxy it same-origin. Embed mode is `?embed=1&proto=json`; the protocol is in 7.4. The `xmlsvg` export gives one file that renders as an image anywhere (PDF included) and reopens in the editor. Its exporter for server-side rendering (`jgraph/export-server`) is end of life, so a diagram Claude writes as XML has no preview until a browser opens it. That is the main reason it is not the v1 pick, together with the extra JVM container. The docs say embed mode is "only supported" on `embed.diagrams.net`; for the self-hosted image this needs a spike.

**Mermaid.** `securityLevel` defaults to `'strict'` (HTML in labels encoded, click handlers off), and `secure` keys cannot be overridden from a diagram's front-matter. Version 12 requires ES2024 / Safari 17.4+, which matches the Angular 22 browser targets. Set `maxTextSize` and `maxEdges` (defaults 50000 / 500) as they are. Re-render on theme change.

**Konva / Fabric.** MIT canvas libraries. A usable whiteboard (selection, snapping, bound arrows, undo, text editing, export) is months of work that Excalidraw already did.

**Kroki / PlantUML.** Good if teams already have PlantUML. Mermaid covers sequence, class, state, ER, Gantt, C4 and flowcharts, so this waits for demand.

---

## 2. Recommended combination

1. **Mermaid fenced blocks in pages** are the default diagram for anything Claude writes or edits over MCP. They live in the page markdown, so versioning, search, diff and PDF come for free. The page view renders them lazily with `layout: 'dagre'`.
2. **Excalidraw whiteboards** are a separate node kind in the docs tree (sibling of pages), for free drawing and hand-made box-and-arrow diagrams. A page embeds a board with `![Board title](/docs/boards/<id>.svg)`, served from the stored SVG snapshot.
3. A **"Convert to whiteboard"** action on a rendered Mermaid block uses `parseMermaidToExcalidraw` + `convertToExcalidrawElements`, so a Claude draft can become a hand-edited board.
4. **draw.io later**, as a third node kind, only if users ask for BPMN/UML/network stencils. The node-kind abstraction (section 5) keeps that additive.

Why not draw.io first: it adds a JVM container, an iframe and a second origin policy, and Claude-written XML has no server-side preview. Why not only Mermaid: people need to sketch, and Mermaid cannot place things by hand.

How whiteboards reach the PDF and `<img>` tags: on every save the editor calls `exportToSvg` (fonts inlined) and sends the SVG with the scene JSON. The API stores both. The SVG is untrusted client output, so it is only ever served as `image/svg+xml` with `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; font-src data:` and `X-Content-Type-Options: nosniff`, and only embedded through `<img>` (scripts in an SVG do not run in an `<img>`). MCP exposes whiteboards read-only in v1 (title, text elements via `getTextFromElements`-equivalent extraction on the server from the JSON `text` fields, and the scene JSON). Writing boards over MCP would leave the SVG snapshot stale; defer it.

---

## 3. PDF export

### 3.1 Options

| Option | License | Renders our markdown faithfully | Mermaid / SVG | Folder export + ToC | Offline in compose | Verdict |
|---|---|---|---|---|---|---|
| Browser print stylesheet (Save as PDF) | n/a | Yes (it is the SPA) | Yes | Manual, one page at a time; print dialog differs per browser | Yes | Keep as a free extra (`@media print` on the page view), not the feature |
| pdfmake 0.3.13 / jsPDF 4.2.1 (client) | MIT / MIT | No: their own layout model, HTML has to be re-implemented | Rasterize only | Possible, poor | Yes | Rejected |
| **Gotenberg 8.39.0 `-chromium`** | **MIT** | Yes: Chromium | Yes (JS on, network off) | One HTML with ToC + `generateDocumentOutline` bookmarks | Yes | **Recommended** |
| Playwright / Puppeteer sidecar (own Node service) | Apache-2.0 (`playwright-core@1.64.1`, `puppeteer@25.16.0`) | Yes | Yes | Same as Gotenberg | Yes | Works, but we would write and harden what Gotenberg already ships (queue, restarts, allow-lists, auth) |
| Microsoft.Playwright 1.64.1 / PuppeteerSharp 25.15.0 inside the API | Apache-2.0 / MIT | Yes | Yes | Yes | Needs Chromium + deps in the API image | Rejected: the API image is chiseled (no shell), and a browser crash or memory spike would take the API with it |
| WeasyPrint 70.0 | BSD-3-Clause | Good CSS paged media, `target-counter()` works | **No JavaScript**: Mermaid must be pre-rendered | Best ToC (real page numbers) | Yes (Python container) | Runner-up; revisit if printed page numbers matter more than Mermaid-in-PDF simplicity |
| QuestPDF 2026.9.1 | Paid for us (F2) | No (C# layout DSL) | n/a | n/a | Yes | Rejected |

### 3.2 Architecture

```mermaid
flowchart LR
  SPA -->|GET .../pages/{id}/pdf| Api
  SPA -->|POST .../docs/exports| Api
  Api -->|multipart: index.html, print.css, mermaid.min.js, images, footer.html| Pdf[pdf: gotenberg 8.39.0-chromium]
  Api --> Db[(PostgreSQL)]
  subgraph render [network: render, internal]
    Pdf
  end
```

* **The renderer never fetches anything.** The API builds a self-contained bundle and posts it to `POST /forms/chromium/convert/html`. Gotenberg writes every part into one flat temp dir under `/tmp`, so the HTML references files by bare name (`src="a-0193....png"`, no folders, no `<base>`). Contents:
  * `index.html`: Markdig HTML for the page (or for every page of a folder, each in a `<section>` with `break-before: page`), a cover and a linked ToC for folder exports, `<pre class="mermaid">` blocks.
  * `print.css` (typography, tables, `@page` size/margins, code colours), `highlight.min.js` and `mermaid.min.js` (5.5 MB, included only when the page has Mermaid blocks), plus `print.js` that runs highlighting and Mermaid and then sets `window.__printReady = true`.
  * Every referenced attachment image (looked up by id through `IAttachmentStore`, after `IProjectAccess` checks) and every embedded whiteboard SVG snapshot.
  * `footer.html` with Chromium's `pageNumber` / `totalPages` classes and the page title.
* **Markdown on the server**: Markdig with `UseAdvancedExtensions()` minus the ones the SPA does not support, `DisableHtml()` so raw HTML is escaped (spec 2), an auto-link pass for ticket keys, and a link rewriter that only keeps `http`, `https`, `mailto` and internal routes. Run the result through `HtmlSanitizer` 9.2 (MIT) as a second layer. Golden tests compare Markdig output with `renderMarkdown()` for the shared fixture set, the same way the XSS fixtures are shared today.
* **Single page: synchronous.** `GET /api/projects/{key}/docs/pages/{id}/pdf` streams the PDF back. Typical cost is 1-3 s; set the `HttpClient` timeout to 45 s and Gotenberg `API_TIMEOUT=60s`.
* **Folder or whole space: background job.** `POST /api/projects/{key}/docs/exports` returns `202` with an export id. A `BackgroundService` claims rows from `doc_exports` with `FOR UPDATE SKIP LOCKED`, renders, stores the PDF through the attachment store, and marks the row done. The SPA polls `GET .../exports/{id}` (the same shape as an MCP tool, so Claude can trigger an export too). `DataRetentionService` deletes export files after 24 h. Above ~300 pages, render per top-level folder and merge with `POST /forms/pdfengines/merge`.
* **Auth**: the renderer is not called with user credentials and never calls back. The API authenticates to Gotenberg with basic auth (`API_ENABLE_BASIC_AUTH` + `GOTENBERG_API_BASIC_AUTH_USERNAME/PASSWORD`). Gotenberg has no published port and sits on an internal network with the API only.
* **No SSRF**: `CHROMIUM_ALLOW_LIST=^file:///tmp/.*` (only the uploaded bundle), `CHROMIUM_DENY_PRIVATE_IPS` and `CHROMIUM_DENY_PUBLIC_IPS` on, `API_DISABLE_DOWNLOAD_FROM=true`, `WEBHOOK_DISABLE=true`, and the compose network is `internal: true` so even a bypass has no route out. JavaScript stays on for Mermaid; injected script could only read the page it is printing, which the requesting user can already read. `failOnResourceLoadingFailed=true` turns a missing image into a 409 we can log instead of a silently broken PDF.
* **Resource limits**: `mem_limit: 1g`, `cpus: "1.0"`, `CHROMIUM_MAX_CONCURRENCY=2`, `CHROMIUM_MAX_QUEUE_SIZE=10` (a full queue returns 503, mapped to `docs.export.busy`), `CHROMIUM_RESTART_AFTER=50`, `API_BODY_LIMIT=100MB`. On the API side, a per-user rate limit on the sync endpoint (for example 10/min) and at most one running export job per project.

---

## 4. Editor for long-form pages

| Option | Version | License | Size (gz, measured) | Keeps markdown exactly | Tables | Paste images | Slash commands | `[[` links / ticket keys | Outline |
|---|---|---|---|---|---|---|---|---|---|
| Current textarea + Write/Preview tabs | ours | | 0 | Yes | Type GFM by hand | Yes (upload handler) | No | No | No |
| **CodeMirror 6** (`codemirror@6.0.2`, `@codemirror/lang-markdown@6.5.2`) | 6.x | MIT | 202 KB with `basicSetup`; less with hand-picked extensions | **Yes** | Source + preview; a "format table" command is small | Yes (reuse handler) | Yes, via `@codemirror/autocomplete` on `/` | Yes, autocomplete sources | From the Lezer markdown tree |
| Milkdown Crepe (`@milkdown/crepe@7.23.0`) | 7.23 | MIT | 352 KB initial, 897 KB all chunks | No: remark re-serializes (list markers, escapes, spacing) | WYSIWYG | Yes (upload hook) | Built in | Plugin work | Plugin work |
| Tiptap 3 (`@tiptap/core` + `starter-kit` + `@tiptap/markdown@3.32.0`) | 3.32 | MIT core; paid platform features (F10) | 139 KB | No: ProseMirror doc → markdown | Extension | Extension | Build or paid UI kit | Build | Build |

**Recommendation for v1: CodeMirror 6 in split view** (source left, our existing `renderMarkdown` preview right, synced scroll; single pane with a toggle on narrow screens). Reasons:

* Claude edits pages over MCP as markdown text. A WYSIWYG editor that re-serializes would rewrite lines Claude never touched, so every human save after an LLM edit (and vice versa) produces noise in history and conflicts. A source editor leaves untouched bytes alone.
* Every feature on the list fits as a CodeMirror extension: paste/drop upload (reuse `MarkdownUploadHandler`), `/` slash menu (heading, table, Mermaid block, whiteboard embed, ticket link), `[[` completion that inserts a standard markdown link to the page id, ticket-key completion, outline panel from heading nodes, `Mod-s` save registered through `ShortcutService`.
* It is lazy (only on the edit route), and the ticket description editor can adopt it later.

**Path later**: if non-technical authors find the source view hard, add Milkdown Crepe as an optional "rich" mode per user, with a warning that it normalizes formatting. Both work on the same markdown column, so it is a frontend-only change.

**Page links**: store standard markdown links, `[Release checklist](/projects/TKT/docs/0193a2f4-...)`. They render in any markdown viewer and in Claude's context, survive renames (resolved by id; the label is refreshed on render when the target title changed), and need no non-CommonMark syntax. `[[` is only the editor's input gesture. Ticket keys keep working as they do today.

---

## 5. PostgreSQL storage and search

All of it is a new additive migration (ADR 0006).

```text
doc_nodes          id uuid v7, project_id, parent_id null, kind ('folder'|'page'|'whiteboard'),
                   title, rank (fractional index, ADR 0010, via the ranker), version int,
                   created/updated by+at, deleted_at (soft delete -> trash)
doc_pages          node_id pk, body_md text COMPRESSION lz4, body_text text (Markdig plain text),
                   outline jsonb (headings), search_vector tsvector GENERATED STORED
doc_whiteboards    node_id pk, scene_json jsonb COMPRESSION lz4, snapshot_svg text, snapshot_version int
doc_page_versions  node_id, version, title, body_md COMPRESSION lz4, author_id, created_at, source ('web'|'mcp')
doc_links          from_node_id, to_node_id null, to_ticket_id null  (one of the two set)
doc_attachments    id, node_id, ... same columns as attachments; bytes through IAttachmentStore
doc_exports        id, project_id, root_node_id, requested_by, status, file_id, created_at, finished_at
```

* **Versions: full copies, not diffs.** Markdown pages are small, and the `postgres:18.6-alpine` image is built `--with-lz4` (checked with `pg_config --configure`), so `COMPRESSION lz4` on the text columns keeps 200 versions of a 50 KB page around a few MB. Diffs are computed when someone opens history: `diff@9.0.0` (BSD-3-Clause) in the SPA, `DiffPlex 1.9.0` (Apache-2.0) in the API for an MCP `get_page_history` that returns unified diffs. Coalesce autosaves: a new version row only when the author changes, on explicit save, or after 10 minutes. Whiteboards keep fewer versions (on close or every 30 minutes) because scene JSON with free drawing can reach several hundred KB.
* **Concurrency**: `doc_nodes.version` is the optimistic concurrency token. The REST `PUT` and the MCP `update_page` both take `baseVersion`; a mismatch is `docs.page.versionConflict` with a hint to re-read. Offer an MCP `edit_page` that takes `{ oldText, newText }` replacements so Claude does not resend a 40 KB page to change a line.
* **Search**: same approach as tickets. `search_vector = setweight(to_tsvector(cfg, title), 'A') || setweight(to_tsvector(cfg, body_text), 'B')` with a GIN index, queried with `websearch_to_tsquery` and the existing `TicketSearch.Configuration` so ranking behaves the same. Index `body_text` (Markdig plain text, including Mermaid source and whiteboard text) instead of raw markdown, so link URLs and syntax do not pollute the index. `ts_headline` only for the top 20 hits. Add a trigram index on `title` for QuickJump. Polish text gets weak stemming with `'english'`; that is the same limitation tickets have today.
* **Links and backlinks**: rebuild `doc_links` for a page inside the save transaction from the Markdig AST (internal page links and ticket keys). Backlinks are one indexed query. Tickets get a "Referenced in docs" section through `provideTicketDetailSection`, without editing the ticket view.
* **Attachments**: reuse `IAttachmentStore` and the upload/download pipeline, but in a separate `doc_attachments` table. `Attachment.TicketId` is required and `MaxPerTicket` is a ticket rule, so widening that entity would leak docs concerns into tickets. Whiteboard SVG snapshots are not attachments (SVG is not in the allowed types, and should stay out of it).
* **Authorization**: everything goes through `IProjectAccess` and `ReadableProjects()`; copy the leak-guard test for every docs read path, the PDF endpoint and the export job (the job re-checks access for the requesting user when it runs).

---

## 6. MCP tools (what makes it LLM-friendly)

`list_doc_tree`, `get_page` (markdown + version + outline + backlinks), `create_page`, `update_page` (full body + `baseVersion`), `edit_page` (exact-text replacements + `baseVersion`), `move_doc_node`, `search_docs`, `get_page_history` (versions + unified diff), `get_whiteboard` (read-only: title, text, scene JSON), `export_docs_pdf` (starts a job, returns its id). Each calls the same handler as the REST endpoint. Tool descriptions should tell Claude to use Mermaid fenced blocks for diagrams and markdown links to page ids for cross-references.

---

## 7. Integration snippets

### 7.1 Excalidraw as a React island in Angular 22 (zoneless)

`angular.json` (build options). The CSS goes in a non-injected bundle so the initial bundle stays under budget; fonts are copied for offline use:

```json
"styles": [
  "src/styles.scss",
  { "input": "node_modules/@excalidraw/excalidraw/dist/prod/index.css", "bundleName": "excalidraw", "inject": false }
],
"assets": [
  { "glob": "**/*", "input": "public" },
  { "glob": "**/*", "input": "node_modules/@excalidraw/excalidraw/dist/prod/fonts", "output": "excalidraw/fonts" }
],
"allowedCommonJsDependencies": ["react", "react-dom", "react-dom/client"]
```

React picks its production build because esbuild defines `process.env.NODE_ENV` as `"production"` when all minify options are on (Angular sets them in production builds). Add `"define": { "process.env.NODE_ENV": "'production'" }` to the production configuration if you want that explicit.

```ts
@Component({
  selector: 'tk-whiteboard-canvas',
  template: `<div #host class="host"></div>`,
  styles: `.host { height: 100%; min-height: 480px; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WhiteboardCanvasComponent {
  readonly scene = input.required<WhiteboardScene>();
  readonly dark = input(false);
  readonly readOnly = input(false);
  readonly sceneChange = output<WhiteboardSceneChange>();

  private readonly host = viewChild.required<ElementRef<HTMLElement>>('host');
  private readonly injector = inject(Injector);
  private root?: import('react-dom/client').Root;
  private destroyed = false;

  constructor() {
    afterNextRender(() => void this.mount());
    inject(DestroyRef).onDestroy(() => {
      this.destroyed = true;
      this.root?.unmount();
    });
  }

  private async mount(): Promise<void> {
    loadStylesheetOnce('excalidraw.css');
    (window as { EXCALIDRAW_ASSET_PATH?: string }).EXCALIDRAW_ASSET_PATH = '/excalidraw/';
    const [{ createElement }, { createRoot }, ex] = await Promise.all([
      import('react'),
      import('react-dom/client'),
      import('@excalidraw/excalidraw'),
    ]);
    if (this.destroyed) return;

    const root = (this.root = createRoot(this.host().nativeElement));
    const initialData = this.scene();
    let lastHash = ex.hashElementsVersion(initialData.elements);

    effect(
      () =>
        root.render(
          createElement(ex.Excalidraw, {
            initialData,
            theme: this.dark() ? 'dark' : 'light',
            viewModeEnabled: this.readOnly(),
            aiEnabled: false,
            validateEmbeddable: false,
            onChange: (elements, appState, files) => {
              const hash = ex.hashElementsVersion(elements);
              if (hash === lastHash) return;
              lastHash = hash;
              this.sceneChange.emit({ elements, appState, files });
            },
          }),
        ),
      { injector: this.injector },
    );
  }
}
```

* `initialData` is read once at mount; later changes go through the imperative API (`excalidrawAPI` prop → `updateScene`), not props.
* `onChange` fires on pointer moves; the hash check drops no-op calls, and the store debounces saves (for example 1.5 s) and calls `exportToSvg({ elements, appState, files })` only on save.
* Zoneless needs nothing special: React callbacks emit outputs or set signals, and signals schedule change detection.
* `loadStylesheetOnce` appends `<link rel="stylesheet" href="excalidraw.css">` once.

CSP change in `web/nginx/security-headers.conf` (F7): `script-src 'self' 'wasm-unsafe-eval'`.

### 7.2 Gotenberg in compose and the API call

```yaml
  pdf:
    image: gotenberg/gotenberg:8.39.0-chromium
    environment:
      API_ENABLE_BASIC_AUTH: "true"
      GOTENBERG_API_BASIC_AUTH_USERNAME: ticketing
      GOTENBERG_API_BASIC_AUTH_PASSWORD: ${PDF_PASSWORD:?set PDF_PASSWORD in .env}
    command:
      - gotenberg
      - --api-timeout=60s
      - --api-body-limit=100MB
      - --api-disable-download-from=true
      - --webhook-disable=true
      - --chromium-allow-list=^file:///tmp/.*
      - --chromium-deny-private-ips=true
      - --chromium-deny-public-ips=true
      - --chromium-max-concurrency=2
      - --chromium-max-queue-size=10
      - --chromium-restart-after=50
    networks: [render]
    mem_limit: 1g
    cpus: "1.0"
    restart: unless-stopped

  api:
    networks: [default, render]
    environment:
      Pdf__BaseUrl: http://pdf:3000
      Pdf__Password: ${PDF_PASSWORD:?set PDF_PASSWORD in .env}

networks:
  render:
    internal: true
```

```csharp
using var form = new MultipartFormDataContent();
form.Add(new StringContent(html), "files", "index.html");
form.Add(new StringContent(footerHtml), "files", "footer.html");
foreach (var asset in bundle.Assets)
    form.Add(new StreamContent(asset.Content) { Headers = { ContentType = new(asset.ContentType) } }, "files", asset.FileName);
form.Add(new StringContent("true"), "printBackground");
form.Add(new StringContent("true"), "preferCssPageSize");
form.Add(new StringContent("true"), "generateDocumentOutline");
form.Add(new StringContent("window.__printReady === true"), "waitForExpression");
form.Add(new StringContent("true"), "failOnResourceLoadingFailed");
form.Add(new StringContent("true"), "failOnConsoleExceptions");
form.Add(new StringContent(JsonSerializer.Serialize(new { Title = title })), "metadata");

using var request = new HttpRequestMessage(HttpMethod.Post, "/forms/chromium/convert/html") { Content = form };
request.Headers.Add("Gotenberg-Trace", Activity.Current?.TraceId.ToString());
var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, cancellationToken);
```

Register the client with `AddHttpClient<GotenbergPdfRenderer>` (base address, basic auth header, 45 s timeout) behind an `IPdfRenderer` abstraction in Application, implemented in Infrastructure, so a WeasyPrint or Playwright backend can replace it.

### 7.3 Mermaid in the page view

```ts
let mermaidReady: Promise<typeof import('mermaid').default> | undefined;

function loadMermaid() {
  return (mermaidReady ??= import('mermaid').then(({ default: mermaid }) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      layout: 'dagre',
      look: 'classic',
      theme: 'base',
      htmlLabels: false,
    });
    return mermaid;
  }));
}

export async function renderMermaidBlocks(root: HTMLElement, themeVariables: Record<string, string>) {
  const blocks = root.querySelectorAll<HTMLElement>('pre > code.language-mermaid');
  if (!blocks.length) return;
  const mermaid = await loadMermaid();
  for (const [i, code] of blocks.entries()) {
    const source = `%%{init: ${JSON.stringify({ themeVariables })}}%%\n${code.textContent ?? ''}`;
    const { svg } = await mermaid.render(`tk-mmd-${i}-${crypto.randomUUID()}`, source);
    code.parentElement!.outerHTML = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
  }
}
```

Run it after `renderMarkdown()` has sanitized the page, so Mermaid sees the code block text, never raw HTML. On a parse error, keep the code block and show the error under it. `htmlLabels: false` keeps labels as SVG `<text>` (no `foreignObject`), which DOMPurify's SVG profile and the PDF both handle.

### 7.4 draw.io embed protocol (for the deferred node kind)

nginx: `location /drawio/ { proxy_pass http://drawio:8080/drawio/; }` with `frame-ancestors 'self'` and `X-Frame-Options SAMEORIGIN` on that location only; the container gets `DRAWIO_SERVER_URL=https://<host>/drawio/` and `DRAWIO_CONFIG='{"compressXml":false}'`, and no OAuth variables.

```ts
const frame = `/drawio/?embed=1&proto=json&spin=1&noExitBtn=1&saveAndExit=0&noSaveBtn=0&offline=1&ui=${dark ? 'dark' : 'kennedy'}`;

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin || e.source !== iframe.contentWindow || typeof e.data !== 'string') return;
  const msg = JSON.parse(e.data);
  switch (msg.event) {
    case 'init':   post({ action: 'load', xml: storedXml, autosave: 1 }); break;
    case 'autosave':
    case 'save':   store.saveXml(msg.xml); if (msg.event === 'save') post({ action: 'export', format: 'xmlsvg' }); break;
    case 'export': store.saveSnapshot(msg.data); break;   // data URI of SVG with the XML embedded
  }
});
const post = (m: object) => iframe.contentWindow!.postMessage(JSON.stringify(m), location.origin);
```

---

## 8. Spikes before committing (about 2 days)

1. Excalidraw under `@angular/build` 22.2.4: the module worker and font-subsetting Wasm load from our origin with the CSP change; `exportToSvg` output renders in Gotenberg with no network.
2. Mermaid 12.2.0 with `layout: 'dagre'` in Angular: measured chunk sizes match section 1.2; dark theme via `themeVariables` from `--mat-sys-*`.
3. Gotenberg: a 200-page folder export inside `mem_limit: 1g`; time per page; confirm that the allow-list blocks an `<img src="http://api:8080/...">` injected into a page.
4. Markdig vs `renderMarkdown()` parity on the shared markdown fixtures (tables, task lists, autolinks, ticket keys, escaped HTML).
5. CodeMirror 6 with hand-picked extensions: size target under 150 KB gz on the edit route.

## Sources

* npm registry (`npm view <pkg> version license time dist-tags dependencies`), 2026-10-27: `@excalidraw/excalidraw`, `@excalidraw/mermaid-to-excalidraw`, `tldraw`, `mermaid`, `@mermaid-js/tiny`, `konva`, `fabric`, `@milkdown/crepe`, `@milkdown/kit`, `@tiptap/core`, `@tiptap/starter-kit`, `@tiptap/markdown`, `codemirror`, `@codemirror/view`, `@codemirror/lang-markdown`, `react`, `react-dom`, `pdfmake`, `jspdf`, `puppeteer`, `playwright-core`, `pagedjs`, `highlight.js`, `@highlightjs/cdn-assets`, `diff`, `markdown-it`.
* tldraw license: `LICENSE.md` in the `tldraw@5.5.2` tarball → https://github.com/tldraw/tldraw/blob/main/LICENSE.md ; https://tldraw.dev/pricing
* Excalidraw: https://docs.excalidraw.com/docs/@excalidraw/excalidraw/installation ; type definitions and `dist/prod` in `@excalidraw/excalidraw@0.18.1`.
* Mermaid: https://mermaid.js.org/config/schema-docs/config.html ; release notes https://github.com/mermaid-js/mermaid/releases/tag/mermaid%4012.0.0
* draw.io: https://www.drawio.com/doc/faq/embed-mode ; https://www.drawio.com/doc/faq/supported-url-parameters ; https://github.com/jgraph/docker-drawio (README) ; `LICENSE` and `VERSION` in https://github.com/jgraph/drawio ; Docker Hub `jgraph/drawio` tags.
* Gotenberg: https://gotenberg.dev/docs/configuration ; https://gotenberg.dev/docs/convert-with-chromium/convert-html-to-pdf ; `LICENSE` in https://github.com/gotenberg/gotenberg ; Docker Hub `gotenberg/gotenberg` tags (`8.39.0-chromium`).
* QuestPDF: https://www.questpdf.com/license/community.html
* Tiptap: https://tiptap.dev/pricing
* esbuild `process.env.NODE_ENV` rule: https://esbuild.github.io/api/#platform ; `@angular/build@22.2.4` `src/tools/esbuild/application-code-bundle.js`.
* NuGet flat container: `markdig` 1.5.0 (BSD-2-Clause nuspec), `htmlsanitizer` 9.2.1039 (MIT), `questpdf` 2026.9.1, `microsoft.playwright` 1.64.1, `puppeteersharp` 25.15.0, `diffplex` 1.9.0. PyPI: `weasyprint` 70.0.
* GitHub API (`/repos/...`): license SPDX, last push and archive status for excalidraw, mermaid, drawio, milkdown, tiptap, codemirror/dev, kroki, WeasyPrint, pagedjs.
* Postgres: `docker run --rm --entrypoint pg_config postgres:18.6-alpine --configure` → `--with-lz4 --with-zstd --with-icu`.
* Repo context: `docs/adr/0009-frontend-stack.md`, `docs/research/tech-stack.md`, `web/nginx/security-headers.conf`, `src/Ticketing.Domain/Attachments/Attachment.cs`, `src/Ticketing.Infrastructure/Persistence/Configurations/TicketConfiguration.cs`.
