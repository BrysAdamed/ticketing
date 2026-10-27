# Frontend development

The Angular 22 SPA lives in `web/`. It uses standalone components, zoneless change detection, signals, Angular Material 22 + CDK restyled with our tokens, Tabler icons via `@ng-icons`, Vitest unit tests and Playwright e2e tests (`e2e/`). Product rules come from [the spec](../product/01-refined-spec.md), the REST contract from [api-conventions.md](../architecture/api-conventions.md) and the look from [docs/design](../design/).

## Run it

| Command (in `web/`) | What it does |
| --- | --- |
| `npm start` | `ng serve` on :4200. `proxy.conf.json` forwards `/api`, `/mcp`, `/scalar` and `/health` to the API on `http://localhost:5080`. |
| `npm run start:mock` | Tiny Node stand-in for the API on :5080 (auth, `/me`, `/me/flags`, `/me/notifications`, projects). Use it when the backend isn't running, and stop it before you start the real API, because both use port 5080. Sign in as `admin@ticketing.local` / `ChangeMe-Admin-2026!`. |
| `npm run build` | Production build into `dist/ticketing-web/browser`. It fails over the bundle budget. |
| `npm test` | Vitest run, once. `npm run test:watch` keeps watching. |
| `npm run lint` | ESLint (angular-eslint, template a11y and the architecture import rules below). |
| `npm run format` | Prettier. |

Node 24 (`.nvmrc`). TypeScript must stay on 6.0.x (Angular 22 requirement).

Docker: `docker build -t ticketing-web web` builds the app with Node, then serves it with `nginx-unprivileged` on port 8080 (`web/nginx/`). nginx serves the SPA with an `index.html` fallback. It proxies `/api`, `/mcp` (no buffering, 1 h timeouts), `/scalar` and `/health` to `${API_UPSTREAM}` (default `api:8080`, resolved at request time, so the container starts even when the API isn't up yet). Hashed assets are cached for a year and `index.html` is `no-cache`. Responses are gzipped and carry security headers, including a CSP: `script-src 'self'` (no inline scripts; the theme bootstrap is `public/theme-init.js`), and `style-src 'self' 'unsafe-inline'` because Angular injects component styles at runtime. In compose, the `web` service publishes host port 8080; the API port 5080 that `ng serve` proxies to is published only by `docker-compose.override.yml` (development). Access logs omit the `/set-password` query string and Referer query strings, and HSTS is sent only over HTTPS (D-76).

## Structure

```
web/src/
  styles/               tokens (_tokens.scss, the single source of truth for design tokens), Material theme + overrides, base, markdown
  app/
    app.routes.ts       top-level routes only (login, set-password, shell + one lazy entry per feature)
    app.config.ts       providers: router, HTTP (XSRF, error interceptor), app initializer, icons, peek view, Material defaults
    core/               app-wide services and the shell. Never imports features.
      api/              ApiClient, ApiError, error interceptor, Page<T>
      auth/             AuthService, authGuard / adminGuard / guestGuard
      flags/            FeatureFlagService, *tkFeature, featureGuard, flagBucket()
      views/            view registry (defineView, viewRoute, ViewRegistry, exposure hook)
      layout/           shell, sidebar, top bar, breadcrumbs, peek panel, NavigationContext
      commands/         command palette + CommandRegistry
      shortcuts/        ShortcutService + "?" help dialog
      notify/           ToastService, ConfirmService
      projects/         ProjectDirectory (readable projects), ProjectContext (current project)
      tickets/          ticket wire types, TicketsApi, TicketCache, TicketEvents, FieldHints, ProjectPeople,
                        TicketCreator (create dialog), TICKET_DETAIL_SECTIONS (ticket view extension point)
      testing/          test case and regression wire types, TestCasesApi, RegressionsApi
      notifications/    NotificationsApi, NotificationCenter (unread count polling, panel state), top bar bell + panel
      theme/            ThemeService (light / dark / system, density)
    shared/             presentational UI kit, domain enums, markdown, pipes. Never imports core or features.
    features/<name>/    one folder per feature: <name>.routes.ts, <name>.views.ts, <page>/<page>.store.ts + <page>.view.ts
```

ESLint enforces the boundaries: `core` and `shared` may not import `@features/*`, `shared` may not import `@core/*`, and a feature may not statically import another feature (`@features/*`). Inside a feature, use relative imports. Path aliases: `@core/*`, `@shared/*`, `@features/*`.

## Routes

| URL | Feature folder | View id |
| --- | --- | --- |
| `/login` | `auth` (implemented) | `auth.login` |
| `/set-password?token=` | `auth` | `auth.set-password` |
| `/my-work` | `my-work` | `my-work.list` |
| `/projects` | `projects` (list implemented) | `projects.list` |
| `/projects/:projectKey` → `dashboard` | `projects` (frame: archived banner, not-found state; sections are sidebar sub-items, D-83) + `dashboard` | `project.layout`, `project.dashboard` |
| `/projects/:projectKey/backlog` | `backlog` | `backlog.list` |
| `/projects/:projectKey/test-cases`, `…/test-cases/:testCaseKey`, `…/test-cases/new?forTicket=KEY` (filters `?status=&q=&ticket=&archived=`) | `test-cases` | `testcases.list`, `testcases.editor` (side pane) |
| `/projects/:projectKey/regressions[/:sessionKey]` (`?status=`; session `?item=KEY&show=mine`, `waiting` or `failed`) | `regressions` | `regressions.list`, `regressions.session` |
| `/projects/:projectKey/docs`, `…/docs/trash`, `…/docs/:docKey[/:slug]` (`/docs/:docKey` and `/p/:projectKey/docs/…` redirect; D-102) | `docs` | `docs.layout`, `docs.home`, `docs.trash`, `docs.doc` (frame) with content views `docs.page`, `docs.diagram`, `docs.folder` |
| `/projects/:projectKey/settings` | `project-settings` | `project.settings` |
| `/tickets/:ticketKey` | `tickets` | `ticket.detail` (presentation `page`) |
| `?peek=KEY` on any shell URL | `tickets` | `ticket.detail` (presentation `peek`) |
| `/boards`, `/boards/:boardId` | `boards` | `boards.list`, `board.kanban` |
| `/search` | `search` | `search.results` |
| `/profile`, `/profile/tokens` | `profile` | `profile.layout`, `profile.general`, `profile.tokens` |
| `/admin/users \| flags \| audit` (Admins only; others get 404) | `admin` | `admin.layout`, `admin.users`, `admin.flags`, `admin.audit` |
| `/dev/ui-kit` | `ui-kit` | `dev.ui-kit` (UI kit catalogue) |
| anything else | `not-found` | `app.not-found` |

Route params arrive as component inputs (`withComponentInputBinding`, `paramsInheritanceStrategy: 'always'`), so a project tab can declare `projectKey = input.required<string>()`.

**Ticket side panel.** We chose a query parameter over a named outlet: `?peek=PAY-128` (`PeekService.open(key)` / `close()`), as `layout-and-screens.md` specifies. It survives reloads, can be shared, and keeps the list route untouched. The shell renders the view registered through `providePeekView(TICKET_DETAIL_VIEW)` with inputs `ticketKey` and `presentation: 'peek'`. Esc or the × button closes it. At 1440 px and wider the panel pushes the content; below that it overlays it. While a peek is open over a ticket page, the ticket shortcuts (`e`, `s`, `w`, …) act on the peeked ticket only; the page takes them back when the peek closes.

## Adding or building a page

Each routed page is a **store** (state + API calls, `@Injectable()` provided by the view) plus a **view** (the component, presentational, reads the store). An A/B variant later is another view over the same store.

1. Store, `features/backlog/backlog.store.ts`:

   ```ts
   @Injectable()
   export class BacklogStore {
     private readonly api = inject(ApiClient);
     readonly tickets = signal<TicketRow[]>([]);
     readonly status = signal<LoadStatus>('idle');
     async load({ projectKey }: { projectKey: string }) { … this.api.get<…>(`/projects/${projectKey}/backlog`) … }
   }
   ```

2. View, `features/backlog/backlog.view.ts`: `providers: [BacklogStore]`, inputs from route params, `effect(() => this.store.load({ projectKey: this.projectKey() }))`.
3. Register it in `features/backlog/backlog.views.ts`:

   ```ts
   export const BACKLOG_VIEW = defineView({
     viewId: 'backlog.list',                 // stable seam for A/B, lower-case dotted
     flag: 'backlog.v2',                     // optional: variant = the flag's value
     variants: {
       default: () => import('./backlog.view').then((m) => m.BacklogView),
       on: () => import('./backlog-v2.view').then((m) => m.BacklogV2View),   // later, if ever
     },
   });
   ```

4. Route it in your own `features/backlog/backlog.routes.ts`: `export default [viewRoute(BACKLOG_VIEW, { path: '' })]`. `viewRoute` sets `loadComponent` to resolve through `ViewRegistry`. It picks the variant whose name equals the flag's evaluated value (`on`/`off` in v1) and falls back to `default` when that variant is missing or fails to load. The router caches the choice for the session. Never put `component`/`loadComponent` on a page route directly.
5. Only touch shared files for a new top-level area (one entry in `app.routes.ts`) or a new project section (one entry in `features/projects/projects.routes.ts`, with `title` and `breadcrumb`, plus `PROJECT_NAV` in `core/layout/sidebar/sidebar.component.ts`).
6. Give every route a `title` (a string or a resolver; the page part only). `PageTitleStrategy` (`core/layout/page-title.ts`) composes `<page> · <project> · Ticketing`. For a title that follows app state use `data: { pageTitle: (route) => … }` (runs in an injection context, may read signals); a page with a dynamic subject calls `PageTitleStrategy.setSubject('PAY-12 Fix the login')`.

Exposure analytics: `provideViewExposure((e) => …)` in `app.config.ts` receives `{ viewId, variant, flag }` every time a view is shown (route activation or peek).

Inside project sections, `inject(ProjectContext)` gives the current project (`project()`, `name()`, `isOwner()`, `rowVersion`), loaded once per key by the project layout (cached, never retried on its own after a 4xx; `reload()` retries). `ProjectDirectory.reload()` refreshes the sidebar and palette after you create or archive a project.

## Core services

| Need | Use |
| --- | --- |
| REST call | `ApiClient` (`get`, `list` → `{ items, nextCursor }`, `post`, `patch(path, body, { rowVersion })` → `If-Match`, `delete`, `idempotencyKey`). Paths are relative to `/api/v1`. XSRF: Angular sends `X-XSRF-TOKEN` from the `XSRF-TOKEN` cookie on unsafe requests. |
| Errors | Every HTTP failure is an `ApiError` (`status`, `code` such as `ticket.parent.cycle`, `title`, `fieldErrors`, `fieldError(name)`, `isConflict`, `isNotFound`, `isValidation`, `traceId`, `retryAfterSeconds`). A 401 sends the user to `/login?returnUrl=…`, except for requests that set the `SKIP_AUTH_REDIRECT` context token. On `409 concurrency.conflict`, refetch. |
| Current user | `AuthService.currentUser()`, `isAdmin()`. Startup runs `GET /auth/csrf`, then `GET /me`, then `GET /me/flags` (`provideAppInitializer`). |
| Guards | `authGuard` (shell), `adminGuard` (`canMatch`, so non-admins fall through to 404), `guestGuard` (login page), `featureGuard('flag.key', 'on')`. |
| Feature flags | `FeatureFlagService.isOn(key)` / `variant(key)` (missing = `off`). Refreshes on window focus when older than 5 minutes. In templates: `<x *tkFeature="'board.swimlanes'; else old" />` or `*tkFeature="'k'; variant: 'b'"`. `flagBucket(flagKey, userId)` matches the C# bucketing, and both are tested against `docs/architecture/flag-bucketing-vectors.json`. |
| Toasts | `ToastService.show / success / warning / error(err)` with an optional `{ action: { label: 'Undo', run } }`. |
| Confirm | `await ConfirmService.confirm({ title, message, confirmLabel, danger, requireText })`. |
| Palette | `CommandRegistry.registerCommands([...], destroyRef)` or `provideCommands(() => [...])` in route providers. Use `registerSearchProvider({ id, remote: true, minQueryLength, search(q, signal) })` for API-backed results (debounced 120 ms, aborted when the query changes). `registerScope({ id, prefix, hint })` adds a query prefix such as `p:`: while it leads the query, commands are hidden, only providers listing the id in `scopes` run (`search(text, signal, scopeId)` gets the text without the prefix) and the footer shows the hint. Registering the command id `ticket.create` shows the top-bar "New ticket" button and turns on the global `C`. |
| Shortcuts | `ShortcutService.registerScoped([{ keys, description, section, handler, allowInInputs }])` for the component's lifetime. The latest registration of the same keys wins (a page can take over `/`). Notation: `mod+k` (Ctrl or ⌘), `shift+enter`, `g b` (sequence), `escape`, `?`. Single keys are ignored while typing in a field unless `allowInInputs` is set, and every shortcut is ignored while an overlay with a backdrop (dialog, menu, picker) is open. Everything registered appears in the `?` sheet. `isRegistered(keys)` tells pickers whether to show their key hint (`PICKER_SHORTCUT_AVAILABLE`). |
| Cached reads | `SwrCache.load(key, fetch, tags)` returns `{ cached, fresh }`: render `cached` at once, then `fresh` (D-84). While cached data is shown the refetch drives the shell's 2px top line. Tag entries (`project:KEY`, `ticketsTag(KEY)`, `MY_WORK_TAG`); `TicketEvents.emit` drops the ticket-list tags. `ApiClient.get` already shares identical in-flight GETs. |
| Breadcrumbs | `data: { breadcrumb: 'Backlog' }` or `(route) => ({ label, projectKey })` on routes. Pages can call `Breadcrumbs.setTail([...])` for dynamic crumbs. |
| Theme | `ThemeService.setPreference('light' \| 'dark' \| 'system')`, `toggle()`, `setDensity('compact')`. Stored in localStorage (`tk-theme`, `tk-density`) and applied as `data-theme` / `data-density` on `<html>` before Angular boots. |
| Notifications | `NotificationCenter` (`core/notifications/`): `unreadCount()` for the top bar bell, polled every 60 s and on window focus while signed in (no push), and the panel state (`open/close/toggle`, `filter` all \| unread, `groups()` by day, `loadMore()`). `markRead(n)` / `markAllRead()` are optimistic with rollback and a toast; `activate(n)` marks read and opens the ticket peek (or navigates to a regression item). REST calls go through `NotificationsApi` (`/me/notifications`). |

Built-in shortcuts: `Ctrl/⌘ K` and `/` open the palette, `?` opens the shortcut sheet, `[` toggles the sidebar, `C` creates a ticket (once registered). With `G` then a letter: `M` My work, `P` Projects, `O` Boards, `N` notifications panel, and, inside a project, `D` dashboard, `B` backlog, `T` test cases, `R` regressions, `W` docs. `Esc` closes the notifications panel, then the peek panel.

## Tickets: shared services and extension points

The tickets slice (`features/tickets`, `features/backlog`) keeps everything other features need in `core/tickets/`, because features must not import each other.

| Need | Use |
| --- | --- |
| Ticket REST calls | `TicketsApi` (`get`, `create`, `update(key, patch, rowVersion?)`, `backlog`, `move`, `find`, `hints`, comments, links, history, `watchers` / `watch` / `unwatch`). Wire types are in `ticket.models.ts`. |
| Instant ticket views | `TicketCache.peek/fetch/prefetch(key)`. Lists call `prefetch` after a 150 ms hover, so the peek opens with data already loaded. |
| Keep lists in sync | `TicketEvents.events` emits `created`, `updated` (with the full ticket), `deleted` and `restored`. Emit them after your own ticket writes, and subscribe in list stores (backlog, boards) to patch rows without a refetch. |
| Delete a ticket | `TicketDeletion.delete(keys)`: no confirm dialog; emits `deleted` at once, runs the DELETEs, and shows a toast whose Undo calls `POST /tickets/{key}/restore` (10 minutes, D-82) and emits `restored`. |
| Move tickets | `MoveTargets.options(projectKey, currentLocation)` lists the backlog and the active boards linking the project as picker options; move with `TicketsApi.move`. |
| Open a ticket | `PeekService.open(key)` for the side panel, or route to `/tickets/:key`. |
| Create a ticket | `TicketCreator.open(prefill)` opens the create dialog with any `NewTicket` fields pre-filled, plus `heading` and an optional `submit(projectKey, ticket)` that replaces the default `POST /projects/{key}/tickets`. The regressions slice uses it for "Create bug" with its own endpoint. It resolves with the created `TicketSummary`, or `null`. The global `C` and the top bar button run the `ticket.create` command registered by `provideTicketCreation` in `app.config.ts`. In the backlog, `C` opens the inline quick-create row instead. |
| Assignee / label / version pickers | `ProjectPeople.picker(() => projectKey)` for a type-ahead `tkSearchPicker` over `GET /users?projectKey=` (any active user on public projects, Admins and Owner/Member members on private ones; never a members-only list), `FieldHints.get(projectKey, 'labels' \| 'version', prefix)`. |
| @mention picker | `ProjectPeople.mentionSearch(() => projectKey)` for the markdown editor's `mentionSearch`: `GET /users?projectKey=&query=&access=read`, every active user who can read the project (viewers included), aborted through the signal. Pass `ticket.mentions` / `comment.mentions` to `tk-markdown` so tokens render as chips. A write with a new mention of someone who can't read the project fails with 400 `mention.invalid` (field `description` or `body`). |

**Ticket view sections (extension point).** Other features add sections to the ticket view (page and peek) without touching the tickets feature. Register one in `app.config.ts`:

```ts
provideTicketDetailSection({
  id: 'test-cases',            // also data-testid="ticket-section-test-cases"
  order: 10,                   // ascending; rendered after sub-tickets and links, before activity
  title: 'Test cases',
  loadComponent: () => import('@features/test-cases/ticket-section/ticket-test-cases.component').then((m) => m.TicketTestCasesComponent),
}),
```

The component is lazily loaded, receives the inputs `ticketKey`, `ticketId` and `projectKey` (declare all three, for example `input.required<string>()`, because unknown inputs are reported as errors), and renders its own heading. Reuse the look of the built-in sections (`sec-h` header with an `h2`, a bordered `box` of 34 px rows). While no section with id `test-cases` is registered, the ticket view shows a read-only test case list from `GET /tickets/{key}` itself.

## Docs: shared client and extension points

| Need | Use |
| --- | --- |
| Docs REST calls | `DocsApi` (`core/docs/docs.api.ts`): `tree`, `recent`, `trash`, `get`, `create`, `rename`, `move`, `duplicate`, `delete`, `restore`, plus the content calls below. Wire types in `doc.models.ts` (`Doc`, `DocTreeItem`, `DocSummary`, `DocTrashItem`, `DocPlacement`, `DOC_TREE_LIMITS`). |
| Doc links | `docUrl(key, title)` → `/projects/{PK}/docs/{KEY}/{slug}`, `docSlug` (same as the server's `DocPaths.Slug`), `docsHomeUrl`, `docPathSegments(path)`, `projectKeyOfDoc`, `DOC_KEY_PATTERN` (`shared/domain/keys.ts`). |
| The tree inside the Docs section | `DocTreeStore` (`features/docs/tree/`, provided by `docs.layout`): `items`, `rows`, `canWrite`, `canManageTrash`, `activeKey`, `cursorKey`, `startCreate(kind, parent)`, `startRename`, `move`, `duplicate`, `delete` (Undo toast), `restore`, `patchFromDoc(doc)` after a write, `structureVersion` (bumped after renames and moves). Pure rules in `doc-tree-logic.ts`. |
| The open doc | `DocStore` (`features/docs/doc/`, provided by the `docs.doc` frame): `doc`, `status`, `load`, `refresh`, `set(doc)` after a write. |
| A content view for a doc kind | Change the loader of `DOCS_PAGE_VIEW`, `DOCS_DIAGRAM_VIEW` or `DOCS_FOLDER_VIEW` in `features/docs/docs.views.ts` (or add a flagged variant). The component takes `doc = input.required<Doc>()` and renders below the page bar. With `?mode=edit` (pages and diagrams of writers) the frame hides its page bar and the content view renders its editor; `E` and the Edit button set it. |
| Page content, drafts, versions | `DocsApi.update(key, { title?, content, baseVersion, changeNote })`, `draft`, `saveDraft`, `saveDraftOnUnload` (keepalive), `discardDraft`, `version(key, n)`, `markdownExportUrl`. Page attachments: `DocAttachmentsApi` (`core/docs/doc-attachments.api.ts`: `list`, `upload`, `delete`, `changes`, `markdownFor`). |
| Editing a doc's text | `DocEditSession` (`features/docs/editing/`, provide it in the editor component): `open(doc)`, `edit({ title?, content? })` (autosave 1 s later), `flush()`, `saveOnUnload()`, `publish(note)` (merges on `doc.version.conflict`), `conflict`, `keepEditingOnLatest`, `overwriteWithMine`, `discard`, `status`, `revision` (reload the editor text when it changes). `mergeThreeWay(base, mine, theirs)` is the pure merge; `createMarkdownEditor` and helpers (`insertBlock`, `wrap`, `prefixLines`, `replaceDocument`) wrap CodeMirror. |
| Rendering a doc's markdown | `tk-doc-markdown` (`features/docs/page/`): heading anchors, callouts, code headers, highlighting and the registered enhancers; `rendered` emits the host after each render. Measured as `performance` entry `tk-doc-markdown`. |
| A section in the page reader | `provideDocPageSection({ id, order, placement: 'footer' \| 'rail', loadComponent })` (`core/docs/doc-extensions.ts`) in the `providers` of `docs.routes.ts`. The component takes `doc = input.required<Doc>()`, is re-created per doc key and renders its own `h2` (copy the attachments section's `sec-h`/`box` look). Footer sections sit below the content (attachments at order 50), rail sections below "On this page". |
| Post-processing rendered markdown (Mermaid, embeds) | `provideDocMarkdownEnhancer({ id, order, enhance(host, { mode, theme, docKey, signal }) })`. It runs after every render in the reader (`mode: 'view'`) and the editor preview (`'preview'`, re-rendered while typing) and after a theme change (the HTML is set again first). Replace descendants only; drop async work once `signal` is aborted. |
| Toolbar buttons, `/` commands, CodeMirror extensions | `provideDocEditorPlugin({ id, order, toolbar?, slashCommands?, extensions? })`. Actions get a `DocEditorCommandContext` (`selectedText`, `replaceSelection`, `insertBlock`, `focus`, `docKey`, `projectKey`); register extra icons with `provideIcons` next to the plugin. `extensions(context)` returns CodeMirror `Extension`s and is loaded with the editor chunk (for `[[` completion, ticket-key completion). |

## UI kit (`shared/`)

Live catalogue: `/dev/ui-kit`. Import components one by one (all standalone, `tk-` prefix). Use them instead of restyling Material for domain values.

| Component / API | Notes |
| --- | --- |
| `tk-icon name size` | Wrapper over ng-icons (Tabler). App-wide icons are in `shared/ui/icon/app-icons.ts`. Register feature-only icons with `viewProviders: [provideIcons({ … })]`. |
| `tk-type-icon [type] [showLabel]` | Epic / User Story / Technical / Spike / Bug glyphs in type colors. |
| `tk-status-icon [status]`, `tk-status-badge [status] [tinted]` | Progress ring for the 8 statuses. The tinted badge uses the status category colour. |
| `tk-priority-icon [priority]` | Signal bars; the label goes to aria-label and title. |
| `tk-severity-badge`, `tk-test-case-status-badge`, `tk-regression-item-badge [autoPassed]`, `tk-regression-session-badge`, `tk-badge [tone] [icon] [dot]` | Badges (20 px, tint only). |
| `tk-label-chip [label]` | Stable colour from FNV-1a(label) mod 8. |
| `tk-avatar [userId] [name] [size]`, `tk-user [user]` | Initials on a stable tint. No user shows "Unassigned"; inactive users show "(deactivated)". |
| `tk-project-tile [projectKey]` | 16 px coloured key tile. |
| `tk-skeleton-rows [count]` | Row skeletons. They appear only after 120 ms. |
| `tk-empty-state icon title description` + projected actions | Empty and error states. `tone="danger"` for errors. |
| `tk-segmented [options] [(value)]` | Radio-group segmented control. |
| `[tkSearchPicker]="searchFn" (picked)` | Like the inline picker, but options come from an async, debounced search (tickets by key or title). |
| `[tkLabelsPicker]="labels" [labelSuggestions]="fn" (labelToggled)` | Multi-select labels popover with suggestions and "create new". Stays open while toggling. |
| `[tkInlinePicker]="options" [pickerValue] (picked)` | CDK overlay listbox with a filter input, ↑/↓/Home/End/Enter/Esc and digits 1–9. Options may carry an `icon` (status, type, priority, severity glyph or a Tabler icon). `[pickerLoad]` loads options on open; `open(origin, options)` opens under another element. Optional `[pickerOptionTemplate]`. Ready-made options are in `shared/domain/picker-options.ts`. |
| `tk-markdown [source] [mentions]` | `renderMarkdown(source, { mentions })`: marked (GFM) → raw HTML escaped → DOMPurify, ticket keys linked to `/tickets/KEY` (router navigation), external links open in a new tab. Mention tokens `@[Name](user:<id>)` (D-96) of the users in `mentions` become `.tk-mention` chips (16 px avatar on the user's stable tint + current display name, `data-testid="mention-<id>"`), built with DOM APIs after sanitizing; any other token shows as plain `@Name`. Tokens in code stay code. Parser and caret helpers: `shared/markdown/mentions.ts`. |
| `tk-markdown-editor [(value)] (submitted) (cancelled) [mentionSearch] [mentions]` | Write / Preview tabs. Ctrl/⌘+Enter submits and Esc cancels. Projected content goes in the footer. With `mentionSearch: (query, signal) => Promise<MentionCandidate[]>`, an `@` at a word start opens a people listbox at the caret (CDK overlay placed with a mirror div, `data-testid="mention-picker"`, rows `mention-option-<email>`): 150 ms debounce, the previous search aborted, at most 8 rows, "No one matches". ↑/↓ move, Enter or Tab insert the token, Esc closes only the picker; with nothing to pick, Enter and Tab keep their usual meaning. `mentions` (users already mentioned) lets Preview show chips. Offer it only on ticket descriptions and comments (D-96). |
| `tk-route-tabs [tabs]` | Material tab nav bar over child routes. Project the `<router-outlet />`. |
| `tk-kbd`, `relativeTime` / `absoluteTime` pipes | Keyboard hints; "3h ago" / "Oct 22". |
| `shared/domain/enums.ts` | Every spec §3 enum as a const array, a union type and a `*_LABELS` map, plus `statusCategory()`. `keys.ts` holds the key regexes. |

### Diagrams (`shared/diagrams`, ADR 0013)

Mermaid, Excalidraw and React are lazy chunks. Never import `mermaid`, `@excalidraw/excalidraw`, `react` or `react-dom` statically from app code; go through these entry points:

| API | Notes |
| --- | --- |
| `renderMermaid(source, theme)` → `{ svg }` or `{ error }` | Loads Mermaid on first use with `mermaidConfig(theme)`: strict security, SVG labels, dagre, token palette. The SVG is DOMPurify-sanitised; the error is the parser message. Renders are serialised. |
| `renderMermaidBlocks(root, theme)` | Replaces every `pre > code.language-mermaid` under `root` (as `renderMarkdown` emits them) with `figure.tk-mermaid`. A block that fails to parse stays as code, followed by `.tk-mermaid-error`. Run it after the HTML is in the DOM, and again when the theme changes. The PDF print bundle calls the same function with `'light'`. |
| `MERMAID_SECURITY_SAMPLES`, `unsafeSvgFindings(svg)` | Hostile sources and the checker for unit tests. `mermaid-renderer.spec.ts` shows how to render in jsdom (stub `getBBox` and `getComputedTextLength`). |
| `tk-canvas-editor [source] [theme] [readOnly] (changed) (loadFailed)` | Excalidraw island. `source` is the stored JSON; a new value reloads the editor, so never bind the editor's own output back into it. `ready()` turns true once mounted; then `serialize()` returns the JSON to store and `exportSvg()` the light snapshot. Give the host a height. |
| `parseCanvasSource`, `emptyCanvasSource`, `exportCanvasSourceSvg(source)` | Stored-format helpers; the last one exports a snapshot without mounting an editor (it still loads Excalidraw). |
| `loadExcalidraw()` | React, react-dom and Excalidraw, with `EXCALIDRAW_ASSET_PATH` pointing at `/excalidraw/` (fonts and CSS copied by `angular.json`). |

Embed a Canvas in a page through its stored snapshot in an `<img>`, not through a read-only editor. In dark mode add `filter: invert(93%) hue-rotate(180deg)`. Excalidraw logs about 230 CSP reports for its `esm.sh` font fallback when it mounts. They are expected; no request is sent.

Global CSS helpers (`styles/`): `.tk-page`, `.tk-page-header` (+ `.tk-page-count`, `.tk-page-actions`), `.tk-toolbar`, `.tk-page-body`, `.tk-icon-btn`, `.tk-field-label` (labels sit above fields, no floating labels), `.tk-callout[-danger|-warning]`, `.tk-popover`, `.tnum`, `.tk-muted`, `.tk-subtle`.

## Theming

`styles/_tokens.scss` is the single source of truth for design tokens; the design docs link to it and there is no copy to keep in sync. The HTML mockups embed an older snapshot and are visual reference only. `_material-theme.scss` maps every M3 system token to a `--tk-*` variable (`mat.theme` + `mat.theme-overrides`, verified against the installed Material 22.2). `_material-overrides.scss` pins component sizes: 32 px controls, 28 px icon buttons, 32 px table rows, no ripples. Wrap toolbars in `.tk-dense` for 28 px controls. Components use semantic tokens only (`--tk-bg`, `--tk-text-muted`, `--tk-status-*`), never primitives, so dark mode works without extra code. Buttons: `mat-flat-button` is primary (at most one per view), `mat-stroked-button` secondary, `mat-button` ghost.

## Testing

- **Unit (Vitest + TestBed, zoneless)**: `*.spec.ts` next to the code. Write them Arrange / Act / Assert. The current suite covers flag bucketing (shared vectors), view registry resolution and fallback, markdown sanitizing and key autolinks, auth guards, ApiError mapping and shortcuts.
- **E2E (`e2e/`, Playwright 1.64)**: `npm install && npx playwright install chromium`, then `npm run typecheck` (`tsc --noEmit`; Playwright only strips types, so type errors would otherwise go unnoticed) and `npm test`. It runs against an already running stack (`E2E_BASE_URL`, default `http://localhost:8080`, i.e. docker compose web → api; use `http://localhost:4200` with `ng serve`). The `setup` project signs in as the bootstrap admin (`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, falling back to `TICKETING_BOOTSTRAP_ADMIN_*`, default `admin@ticketing.local` / `ChangeMe-Admin-2026!`) and saves `.auth/admin.json`, so specs start signed in. To test anonymously, use `test.use({ storageState: { cookies: [], origins: [] } })`.
  - Import `test` and `expect` from `e2e/support/fixtures.ts`. It provides page objects (`loginPage`, `shell`) and `api`.
  - `api` (`e2e/support/api.ts`) uses the admin cookie session and handles XSRF itself (it reads the `XSRF-TOKEN` cookie and echoes it as `X-XSRF-TOKEN`). Seed data through it (`api.createProject()`, `api.post(...)`), never through the UI. Use `uniqueProjectKey()` so parallel tests don't collide.
  - Page objects live in `e2e/pages/*.page.ts`. They expose locators and intent-level methods, never assertions about business rules.
  - Timing budgets go in `*.perf.spec.ts`. The `chromium` project ignores them; the `perf` project runs them only when asked, alone: `E2E_PERF=1 npx playwright test --project=perf` (parallel workers skew the numbers).

### `data-testid` conventions

Use `getByTestId` (configured to `data-testid`) for anything the e2e tests drive; use roles and labels for accessibility assertions.

- kebab-case, `<area>-<element>`: `login-email`, `login-submit`, `topbar`, `sidebar`, `user-menu`, `menu-logout`, `theme-toggle`, `palette-trigger`, `command-palette-input`, `peek-panel`, `toast`.
- Sidebar links: `nav-<target>` (`nav-my-work`, `nav-project-PAY`, `nav-project-backlog`, `nav-admin-flags`). Project tabs: `project-tab-<path>`.
- Every routed view host: `view-<viewId>` (`view-backlog.list`), so a test can wait for the page.
- Repeated items: `<thing>-row-<stable key>` (`project-row-PAY`). Use the business key, never an index.
- Palette items: `palette-item-<id>`. Segmented options: `<testId>-<value>`.
- Test ids are part of the e2e contract: keep them when you refactor markup, and don't put them on purely visual elements.
