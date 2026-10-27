# 13. Diagram editor, Mermaid rendering and PDF pipeline

- Status: Accepted
- Date: 2026-10-27
- Spike: [TKT-11](http://localhost:8090/tickets/TKT-11); prototype code on branch `spike/TKT-11-prototype` (not merged)

## Context

The Docs epic ([TKT-10](http://localhost:8090/tickets/TKT-10), refinement [03-docs-refinement.md](../product/03-docs-refinement.md)) needs three things that the rest of the app does not have: Mermaid diagrams in markdown, a visual Canvas editor (shapes, bound arrows, text, free drawing) and server-side PDF export of pages, diagrams and folders. The research ([docs-and-diagrams.md](../research/docs-and-diagrams.md)) shortlisted Mermaid 12, Excalidraw 0.18 as a React island and a Gotenberg sidecar, and left open: how Excalidraw mounts in Angular 22 zoneless, what it costs and what CSP it needs; whether Mermaid's strict mode is enough; and whether the PDF should be rendered from the SPA's print route or from server-built HTML (Markdig). The spec wants one markdown renderer for screen and PDF (§1.8, §1.11).

The spike built each piece and measured it against the production nginx configuration (CSP included) and a hardened Gotenberg container on an `internal` network.

## Decision

### Libraries (exact pins in `web/package.json`)

| Package | Version | Licence | Loaded |
| --- | --- | --- | --- |
| `mermaid` | 12.2.0 | MIT | Lazy, first Mermaid block |
| `@excalidraw/excalidraw` | 0.18.1 | MIT | Lazy, when a Canvas editor or viewer mounts |
| `react`, `react-dom` | 19.3.1 | MIT | Lazy, with Excalidraw |
| `@types/react`, `@types/react-dom` | 19.3.0 | MIT | Dev only |
| `gotenberg/gotenberg` image | 8.39.0-chromium | MIT | PDF sidecar (TKT-20) |

Excalidraw pulls `@excalidraw/mermaid-to-excalidraw@2.2.2`, which carries its own `mermaid@11.17.2`. It only loads inside Excalidraw's "Mermaid to Excalidraw" dialog chunk; we do not override it.

### Measured cost (production build, nginx gzip, cache disabled)

| Scenario | Transferred |
| --- | --- |
| Initial bundle | 206.04 kB → 206.06 kB est. gzip (+0.02 kB): every new library is a lazy chunk |
| First Mermaid flowchart (core + dagre layout) | +236 KB JS in 28 chunks; first render ~200 ms incl. loading, later diagrams 20–80 ms |
| Sequence + ER diagram types | +43 KB |
| ELK layout (only when a diagram asks for `layout: elk`) | +350 KB |
| Canvas editor opens | +449 KB JS, +24 KB CSS, +62 KB UI fonts; +25 KB Excalifont once text is drawn |
| First SVG snapshot export (font-subsetting worker + Wasm) | +732 KB JS, once per session; export 290–450 ms first, ~60 ms after |
| Snapshot of the sample scene (3 shapes, 2 bound arrows, 5 texts, free draw) | JSON 11 KB, SVG 13.7 KB (41 KB without subsetting) |
| Self-hosted Excalidraw assets on disk (`/excalidraw/`) | 13.3 MB, of which 12.7 MB is the Xiaolai CJK font, fetched per Unicode range only for CJK text |

### Mermaid

`shared/diagrams/mermaid` holds the only Mermaid configuration (`mermaidConfig`) and renderer (`renderMermaid`, `renderMermaidBlocks`):

- `securityLevel: 'strict'`, `htmlLabels: false` (labels are SVG text, no `foreignObject`), `layout: 'dagre'`, `look: 'classic'`, `theme: 'base'` with a light and a dark palette copied from the design tokens, `suppressErrorRendering: true`.
- `secure` adds `htmlLabels` and `dompurifyConfig` to Mermaid's own list, so a diagram's `%%{init}%%` or front-matter cannot loosen them. Diagrams may still pick `layout` and `look`.
- The SVG goes through a second DOMPurify pass (SVG profile, Mermaid's `<style>` kept, `foreignObject` forbidden).
- Renders are serialised because Mermaid's configuration is global and the theme is applied per render.

Six hostile samples (`MERMAID_SECURITY_SAMPLES`: click callback, `javascript:` links, HTML labels, an `init` directive and front-matter asking for `securityLevel: loose` and `htmlLabels: true`, a sequence `link`) render inert: no script, event handler, `foreignObject` or non-http(s) link in the output, already before our DOMPurify pass. In a browser without CSP no `alert` fired. The unit test renders them in jsdom with a stubbed `getBBox`.

### Canvas: Excalidraw as a React island

`shared/diagrams/canvas/CanvasEditorComponent` (`tk-canvas-editor`) mounts Excalidraw with `createRoot` after the first Angular render, and re-renders the React tree from an Angular `effect` when `theme` or `readOnly` change. It needs nothing special for zoneless change detection: React callbacks emit Angular outputs. `react` and `react-dom/client` are CommonJS, so the loader unwraps their `default` export.

- **Stored format**: Excalidraw's native JSON, `serializeAsJSON(elements, appState, files, 'database')`. It opens unchanged in excalidraw.com. `files` stays empty in v1.
- **Snapshot**: on every publish the editor sends `exportSvg()` with the scene. It is always light, with the used glyphs subset and inlined, so it renders in `<img>`, in the PDF and offline.
- **Read-only embeds** use the snapshot in an `<img>`. In dark mode the image gets `filter: invert(93%) hue-rotate(180deg)`, the same transform Excalidraw applies to its own canvas in dark mode, so embeds and the editor look alike. The interactive island with `viewModeEnabled` is for the diagram's own page (pan and zoom), not for embeds: 450 KB per embed is too much.
- **Offline**: `angular.json` copies `dist/prod/index.css` and `dist/prod/fonts` to `/excalidraw/`; the loader sets `window.EXCALIDRAW_ASSET_PATH` to it and adds the stylesheet once. `aiEnabled={false}`, `validateEmbeddable={() => false}`, the image tool, Open, Save to file and Export are off, and the main menu keeps only background colour, clear canvas and help.
- **No egress**: in a run without CSP and with every non-local request intercepted, opening the editor, drawing, saving and exporting made zero requests to other hosts. Under our CSP, Chrome logs about 230 `font-src` violations for `esm.sh` when the editor mounts. Excalidraw always appends its CDN as a second `src` to every `FontFace`, and Chrome checks every source eagerly. Nothing is sent; it is console noise.

### CSP

The page CSP stays as it is (`script-src 'self'`, no eval). Measured:

- Font subsetting for the SVG snapshot runs Emscripten glue that calls `new Function`, so `'wasm-unsafe-eval'` alone is not enough. Under the page CSP the worker fails, the main-thread fallback fails with `EvalError`, and Excalidraw inlines whole font files (41 KB instead of 13.7 KB for the sample, plus a console error per export).
- A CSP header on a script response governs only a worker started from that script; documents ignore it. nginx therefore sends hashed `*.js`/`*.css` files with `script-security-headers.conf`: `default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`. With it, subsetting runs in the worker with no errors, and the page still cannot `eval`.
- Snapshot SVGs are client output. TKT-18 serves them as `image/svg+xml` with `Content-Security-Policy: sandbox; default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:` and `nosniff`, and pages embed them only through `<img>`.

### PDF: offline print bundle in a Gotenberg sidecar

**Rendering source.** Neither of the two candidates; a third option:

- **SPA print route (rejected).** Chromium would need network access to `web` and `api`, a new render-token auth scheme, and it would download the whole SPA for every export.
- **Markdig HTML (rejected).** A second markdown implementation that drifts from `marked` (mentions, ticket chips, callouts, embeds) and needs golden tests forever.
- **Print bundle (chosen).** A small esbuild entry imports the SPA's own `renderMarkdown` and `renderMermaidBlocks` and is built into one classic script, `print.js`. A `print.css` is compiled from the SPA's `_tokens.scss` and `_markdown.scss` plus print rules. The API authorises and resolves everything for the exporting user, writes it as JSON into `index.html` and posts the bundle with `print.js`, `print.css`, the Inter font, the Canvas snapshots and the page images to Gotenberg. The script renders, sets `window.__printReady` and Chromium prints. There is one renderer, no callback from the renderer and no new auth scheme.

**Proof** (prototype `web/print/*` on `spike/TKT-11-prototype`). The bundle is 5.3 MB raw: Mermaid 2.5 MB, elkjs 1.4 MB, cytoscape 0.4 MB, katex 0.3 MB. It came out Angular-free once `initialsOf` moved to `shared/util/initials.ts`. It produced:

| Export | Result | Time (1 CPU, 1 GiB, Docker Desktop) |
| --- | --- | --- |
| One page: 2 Mermaid diagrams, a Canvas SVG, a 40-row table, a code block | A4, 4 pages, 198 KB, 6 bookmarks, `Page x of y` footer, header with title and path, vector text in diagrams (no raster images) | 1.3–2.5 s warm (n=20); 3.4–4.0 s right after a container start; 17 s for the very first render (font cache) |
| Folder of 50 such documents with cover and linked contents | 203 pages, 4.9 MB, 302 hierarchical bookmarks, internal links | 9.4–11.8 s warm, 26 s first; peak memory ~560 MiB |

Both targets of §1.11 (single page p95 < 3 s, 50 documents < 30 s) hold warm. TKT-20 adds a warm-up conversion at API start.

**Isolation** (compose snippet tested in the spike):

- `pdf` sits only on a network with `internal: true`, shared with `api`, and publishes no port. A container on that network could not resolve `example.com`.
- Basic auth between API and renderer (`--api-enable-basic-auth`, credentials from `.env`); wrong credentials get 401.
- `--chromium-allow-list=^file:///tmp/.*`, `--chromium-deny-private-ips`, `--chromium-deny-public-ips`, `--api-disable-download-from`, `--webhook-disable`, `--pdfengines-disable-routes`, `--prometheus-disable-collect`. Injected `<img>` URLs to a public host, the Docker host and the cloud metadata address were filtered and logged, and the conversion still succeeded without them. Chromium's own calls home (`accounts.google.com`, `update.googleapis.com`) are blocked the same way.
- `read_only: true` with `tmpfs` for `/tmp` and `/home/gotenberg`, `mem_limit`, `cpus`, `--chromium-max-concurrency=2`, `--chromium-max-queue-size=10`, `--chromium-restart-after=50`, `--api-timeout=120s`.

**Limits of Chromium printing.**

- Header and footer templates are static per render; only `pageNumber`, `totalPages`, `title`, `url` and `date` are filled in. So a folder export cannot show each document's key in the footer (D-101).
- There are no page numbers in the contents page (no `target-counter()`); the linked contents page and bookmarks are the accepted fallback (§1.11).

## Consequences

- Mermaid, Excalidraw and React never touch the initial bundle. Code must import them only through `shared/diagrams` loaders.
- The web image grows by about 13 MB of Excalidraw fonts and the lazy chunks. The API image (TKT-20) gains a Node build stage for the print bundle and `/app/print`.
- The worker CSP on hashed scripts is a deliberate exception and must stay limited to script responses. It must never reach `security-headers.conf`.
- Canvas snapshots are made in the browser. A Canvas version written over MCP (`create_diagram`, `update_doc`) has no snapshot until a writer opens it: the diagram view mounts the island anyway, so it exports the snapshot and stores it for that version without creating a new one (D-99). Until then embeds and the PDF show a "Preview not rendered yet" placeholder.
- The Gotenberg sidecar is a new service with its own upgrade cadence. `IPdfRenderer` keeps it replaceable (Playwright or WeasyPrint).
- Excalidraw releases are slow (research F6). The island is our own component, so swapping editors stays a local change.
