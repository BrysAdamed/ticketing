# Frontend development

The Angular 22 SPA lives in `web/`. It uses standalone components, zoneless change detection, signals, Angular Material 22 + CDK restyled with our tokens, Tabler icons via `@ng-icons`, Vitest unit tests and Playwright e2e tests (`e2e/`). Product rules come from [the spec](../product/01-refined-spec.md), the REST contract from [api-conventions.md](../architecture/api-conventions.md) and the look from [docs/design](../design/).

## Run it

| Command (in `web/`) | What it does |
| --- | --- |
| `npm start` | `ng serve` on :4200. `proxy.conf.json` forwards `/api`, `/mcp`, `/scalar` and `/health` to the API on `http://localhost:5080`. |
| `npm run start:mock` | Tiny Node stand-in for the API on :5080 (auth, `/me`, `/me/flags`, `/me/notifications`, `/me/achievements`, projects). Use it when the backend isn't running, and stop it before you start the real API, because both use port 5080. Sign in as `admin@ticketing.local` / `ChangeMe-Admin-2026!`. |
| `npm run build` | Production build into `dist/ticketing-web/browser`. It fails over the bundle budget. |
| `npm test` | Vitest run, once. `npm run test:watch` keeps watching. `npm run test:perf` runs only the timing budgets (`*.perf.spec.ts`), which `npm test` skips. |
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
      flags/            FeatureFlagService, *tkFeature, featureGuard, flagBucket(), flag-keys.ts (every FlagKey)
      views/            view registry (defineView, viewRoute, ViewRegistry, exposure hook)
      layout/           shell, sidebar, top bar, breadcrumbs, peek panel, NavigationContext
      commands/         command palette + CommandRegistry
      shortcuts/        ShortcutService + "?" help dialog
      help/             HelpMenuRegistry, provideHelpMenuItem (top-bar Help menu + palette Help group)
      notify/           ToastService, ConfirmService
      projects/         ProjectDirectory (readable projects), ProjectContext (current project)
      tickets/          ticket wire types, TicketsApi, TicketCache, TicketEvents, FieldHints, ProjectPeople,
                        TicketCreator (create dialog), TICKET_DETAIL_SECTIONS (ticket view extension point)
      testing/          test case and regression wire types, TestCasesApi, RegressionsApi
      notifications/    NotificationsApi, NotificationCenter (unread count polling, panel state), top bar bell + panel
      theme/            ThemeService (light / dark / system, density)
      onboarding/       OnboardingStateService (D-132); engine/: guided tours (TourLauncher, TourAnchorRegistry,
                        tkTourAnchor; the session is a lazy chunk, D-131); tours/: tour data + TOUR_CATALOGUE;
                        TourAvailability + provideGuidedTours (eager), GuidedTours (lazy) (D-136);
                        guides/: auto-shown guide data; hints/: HintService, tk-contextual-hint (D-137)
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
| `/projects/:projectKey/docs`, `…/docs/trash`, `…/docs/:docKey[/:slug]` (`/docs/:docKey` and `/p/:projectKey/docs/…` redirect; D-113) | `docs` | `docs.layout`, `docs.home`, `docs.trash`, `docs.doc` (frame) with content views `docs.page`, `docs.diagram`, `docs.folder` |
| `/projects/:projectKey/settings` (tabs: General; Agent while `project.agent` is non-null) | `project-settings` | `project.settings.layout`, `project.settings` |
| `/projects/:projectKey/settings/agent`, `…/settings/agent/:ticketType` (`bug`, `user-story`, …; flag `agent.delegate`) | `project-settings` | `project.settings.agent`, `project.settings.agent-prompt` |
| `/tickets/:ticketKey` | `tickets` | `ticket.detail` (presentation `page`) |
| `?peek=KEY` on any shell URL | `tickets` | `ticket.detail` (presentation `peek`) |
| `/boards`, `/boards/:boardId` | `boards` | `boards.list`, `board.kanban` |
| `/search` | `search` | `search.results` |
| `/profile`, `/profile/tokens`, `/profile/achievements` (flag `achievements`) | `profile` | `profile.layout`, `profile.general`, `profile.tokens`, `profile.achievements` |
| `/admin/users \| flags \| audit` (Admins only; others get 404) | `admin` | `admin.layout`, `admin.users`, `admin.flags`, `admin.audit` |
| `/admin/agent-prompts`, `…/agent-prompts/:slot` (`bug`, `user-story`, …, `guardrails`; Admins with flag `agent.delegate`) | `admin` | `admin.agent-prompts`, `admin.agent-prompt` |
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
     flag: BACKLOG_V2_FLAG,                  // optional, a FlagKey: variant = the flag's value
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
| Guards | `authGuard` (shell), `adminGuard` (`canMatch`, so non-admins fall through to 404), `guestGuard` (login page), `featureGuard(AGENT_FLAG, 'on')`. |
| Feature flags | `FeatureFlagService.isOn(key)` / `variant(key)` take a `FlagKey` from `core/flags/flag-keys.ts` (a key the server did not send is `off`; see "Adding a feature flag"). Refreshes on window focus when older than 5 minutes. In templates: `<x *tkFeature="'ticket.subtickets-graph'; else old" />` or `*tkFeature="'k'; variant: 'b'"`. `flagBucket(flagKey, userId)` matches the C# bucketing, and both are tested against `docs/architecture/flag-bucketing-vectors.json`. |
| Toasts | `ToastService.show / success / warning / error(err)` with an optional `{ action: { label: 'Undo', run } }`, or `actions: [...]` for several (shown in order). A custom toast component goes through `showComponent(component, data, { durationMs })`. A new toast replaces the open one, so a toast the user did not ask for (an achievement unlock) first awaits `whenIdle()` (D-161). |
| Confirm | `await ConfirmService.confirm({ title, message, detail, confirmLabel, danger, requireText })`. For three answers, `choose({ …, alternativeLabel })` resolves `'confirm'`, `'alternative'` or `'cancel'` (Esc); the confirm button has the initial focus, so Enter picks it. |
| Palette | `CommandRegistry.registerCommands([...], destroyRef)` or `provideCommands(() => [...])` in route providers. Use `registerSearchProvider({ id, remote: true, minQueryLength, search(q, signal) })` for API-backed results (debounced 120 ms, aborted when the query changes). `registerScope({ id, prefix, hint })` adds a query prefix such as `p:`: while it leads the query, commands are hidden, only providers listing the id in `scopes` run (`search(text, signal, scopeId)` gets the text without the prefix) and the footer shows the hint. Registering the command id `ticket.create` shows the top-bar "New ticket" button and turns on the global `C`. Give every item a stable `id`: the item the user arrowed to is kept by id while later results arrive (D-161). |
| Shortcuts | `ShortcutService.registerScoped([{ keys, description, section, handler, allowInInputs }])` for the component's lifetime. The latest registration of the same keys wins (a page can take over `/`). Notation: `mod+k` (Ctrl or ⌘), `shift+enter`, `g b` (sequence), `escape`, `?`. Single keys are ignored while typing in a field unless `allowInInputs` is set, Enter and Space on a focused button or link are left to the control (D-133), and every shortcut is ignored while an overlay with a backdrop (dialog, menu, picker) is open. Everything registered appears in the `?` sheet. `isRegistered(keys)` tells pickers whether to show their key hint (`PICKER_SHORTCUT_AVAILABLE`). |
| Cached reads | `SwrCache.load(key, fetch, tags)` returns `{ cached, fresh }`: render `cached` at once, then `fresh` (D-84). While cached data is shown the refetch drives the shell's 2px top line. Tag entries (`project:KEY`, `ticketsTag(KEY)`, `MY_WORK_TAG`); `TicketEvents.emit` drops the ticket-list tags. `ApiClient.get` already shares identical in-flight GETs. |
| Breadcrumbs | `data: { breadcrumb: 'Backlog' }` or `(route) => ({ label, projectKey })` on routes. Pages can call `Breadcrumbs.setTail([...])` for dynamic crumbs. |
| Theme | `ThemeService.setPreference('light' \| 'dark' \| 'system')`, `toggle()`, `setDensity('compact')`. Stored in localStorage (`tk-theme`, `tk-density`) and applied as `data-theme` / `data-density` on `<html>` before Angular boots. |
| Avatars | `AvatarDirectory` (`core/users/`, D-130) holds every chosen avatar from `GET /users/avatars`: loaded after sign-in, refetched when the tab becomes visible and the data is older than 5 minutes, `set(userId, avatar)` for an optimistic own save, cleared on sign-out. It is provided as `AVATAR_SOURCE` (`shared/avatars/avatar-source.ts`) so shared UI resolves avatars by user id (`resolveAvatar`). The icon art is a lazy chunk (`loadAvatarArt()`); add an icon by dropping its Fluent Emoji Flat SVG into `web/vendor/fluent-emoji/flat/<key>.svg`, adding the key to both catalogues (`AvatarCatalog.cs`, `shared/avatars/avatar-catalog.ts`) and running `npm run generate:avatars`. |
| Notifications | `NotificationCenter` (`core/notifications/`): `unreadCount()` for the top bar bell, polled every 60 s and on window focus while signed in (no push; other per-user counts subscribe to `polls` instead of polling themselves), and the panel state (`open/close/toggle`, `filter` all \| unread, `groups()` by day, `loadMore()`). `markRead(n)` / `markAllRead()` are optimistic with rollback and a toast; `activate(n)` marks read and opens the ticket peek (or navigates to a regression item). REST calls go through `NotificationsApi` (`/me/notifications`). |
| Achievements | `AchievementsApi` (`core/achievements/`): `list()` (`GET /me/achievements`, wire types in `achievement.models.ts`), `unseen()`, `markSeen(ids)`, `share(id)` / `unshare(id)` (return the item with `shared`), `sharedBy(userId)` (`GET /users/{id}/achievements`). `AchievementsAccess.enabled()` is the `achievements` flag and no opt-out: `achievementsHidden` from `/me`, overridden for the session by `markDisabled()` (an `achievements.disabled` 404, or the opt-out on Profile → General) and `markEnabled()` (an opt-in, or a successful answer) (D-151, D-153). The profile tab's grouping, ordering and progress rules are pure functions in `features/profile/achievements/achievements.logic.ts`; `ProfileAchievementsStore.setShared(id, shared)` is the optimistic share with rollback and Undo (D-155). `AchievementUnlocks` (D-152) fetches `unseen()` on `NotificationCenter.polls`, hands new tiers to the lazily loaded `AchievementUnlockAnnouncer`, which toasts each once per browser (`AchievementToastComponent`, rules in `achievement-unlocks.logic.ts`), and exposes `hasUnseen()` for the avatar dot and the menu's "New" badge; pass the `markSeen` answer to `apply(...)`. |
| User card | `[tkUserCard]="user"` (`core/users/user-card/`) on a person's name or avatar opens `tk-user-card` with the person's shared achievements (D-155). Default `tkUserCardTrigger="click"`: where a click on the person does nothing else, it makes the host a button (click, Enter; Esc returns focus). `tkUserCardTrigger="hover"`: where the click already edits something (assignee avatars), it opens after 500 ms of hover, like the ticket key tooltip. Wired in: comment and history authors, the watchers list, the Reporter field (hover while editable), board card and backlog row avatars. `shared/` can't host it (it must not depend on `core/`), so shared row components don't open it. |
| Help menu | Adding a Help menu item (D-133): `provideHelpMenuItem(() => ({ id: 'help.<name>', label, icon, order: HELP_MENU_ORDER.<slot>, visible, disabled, hint, run }))` in app or route providers, or `HelpMenuRegistry.register(item, destroyRef)`. The item appears in the top-bar Help menu (`core/help/`) and as a command in the palette's **Help** group; `visible` / `disabled` / `hint` take a signal or `computed`. Use an icon from `APP_ICONS`. The menu item's test id is the id with dots as dashes (`help-shortcuts`). Restart all guides is built in and always last; don't register it. menu: false offers an item in the palette only (one command per tour). |
| Onboarding state | `OnboardingStateService` (`core/onboarding/`, D-132): loads `GET /me/onboarding` after the first render while signed in. `loaded()` (wait for it before auto-showing a guide), `isSeen(guideId, version)` (stored version >= `version`), `complete` / `dismiss(guideId, version)`, `forget(guideId)` and `resetAll()` (optimistic with rollback and a toast), `checklist()`, `ownsProjects()`, `createdAt()` (What's new entries dated before it count as seen), `load()` to refresh. Guide ids must match `GUIDE_ID_PATTERN`. REST calls go through `OnboardingApi`. Guides that show by themselves are declared in `core/onboarding/guides/` and collected in `AUTO_SHOWN_GUIDES` (`auto-guides.ts`, D-134), which the e2e suites import. |
| Contextual hints | Adding a hint (spec 14.5, D-137): append `{ id: 'hint.<name>', version: 1, title, body, requires? }` to `HINTS` in `core/onboarding/guides/hints.ts` (plain data: it is part of `AUTO_SHOWN_GUIDES`, so the e2e guard marks it seen; `requires: 'write'` for a hint about a write action), then place `<tk-contextual-hint hint="hint.<name>" [canWrite]="…" />` (`core/onboarding/hints/`) where the confusion happens. In a picker, pass `<ng-template #hint><tk-contextual-hint hint="…" compact /></ng-template>` as `[pickerFooter]="hint"`. `HintService` decides: after `OnboardingStateService.loaded()`, unseen at its version, `canWrite` for write hints, not while a tour runs or another overlay with a backdrop (dialog, menu, picker) covers it, and only the first registered such hint on the page. "Got it" / × records `hint.<name>` `Dismissed`; Restart all guides brings it back. `(shownChange)` tells a page that measures its layout (the backlog) when it appears or goes. Raise `version` to show a hint again after its copy changes. |
| Guided tours | Start a tour with `GuidedTours.start(viewId, { projectKey?, returnFocusTo?, step? })` or `startCurrent()` (`core/onboarding/guided-tours.ts`, D-136), imported lazily from entry points (`const { GuidedTours } = await import('@core/onboarding/guided-tours')`). It works out access from what the view reports through `ViewTourAccess` (D-138), else from the open project (`OpenProjectState`) and `AuthService.isAdmin()`, opens the view first when the tour has a `path` and the user is elsewhere (or, for a tour with `opens`, a ticket, board or session `TourTargets` found; call `TourAvailability.prepare(viewId)` when showing the entry point, D-170), starts at `step` when given, and stores `Completed` / `Dismissed` at the tour's version (not `aborted` or `interrupted`). `TourAvailability` (eager) says which tour belongs to the view on screen (`current()`) and whether one `canStart(viewId)`. `NavigationContext.currentViewId()` is the deepest activated `viewRoute`'s view id. Never call `TourLauncher` from a feature. |
| Getting-started checklist | `GettingStartedService` (`core/onboarding/checklist/`, D-135): `groups()`, `progress()` (`done` of `total` required items), `next()`, `visible()`, `completed()`, `dismiss()`, `restore()` (forgets the stored state and asks My work to focus the card), `refresh()`. Item copy, groups and hints are plain data in `checklist.model.ts`, keyed by the ids the server returns; link targets are resolved by the card (`features/my-work/checklist-card.component.ts`). Help → Getting started is `provideGettingStartedHelp()` in `app.config.ts`. |

Built-in shortcuts: `Ctrl/⌘ K` and `/` open the palette, `?` opens the shortcut sheet, `[` toggles the sidebar, `C` creates a ticket (once registered). With `G` then a letter: `M` My work, `P` Projects, `O` Boards, `N` notifications panel, and, inside a project, `D` dashboard, `B` backlog, `T` test cases, `R` regressions, `W` docs. `Esc` closes the notifications panel, then the peek panel. In the Docs section `Ctrl/⌘ \` shows or hides the tree and `Ctrl/⌘ .` / `Ctrl/⌘ Shift .` copy the open doc's key / link (D-120). Shifted symbols are written with the unshifted key (`mod+shift+.`); `ShortcutService` matches them by `event.code`.

## Adding a tour

A tour (spec 14.4, D-131, D-136) is data plus anchors; the engine, the Help menu item and the palette command come for free.

1. **Data file**, `core/onboarding/tours/<area>.tours.ts`: export a `TourDefinition`. Plain TypeScript: no Angular or package imports, only relative ones (`../engine/tour.model`), because e2e imports it through `@onboarding/tours/<area>.tours`.

   ```ts
   export const BACKLOG_TOUR: TourDefinition = {
     id: 'tour.backlog.list',      // always `tour.<viewId>`
     version: 1,                   // raise it to show the tour again to everyone who saw it
     viewId: 'backlog.list',       // the view id, never a variant
     title: 'Backlog',             // eyebrow "Backlog tour · Step n of m"
     steps: [
       { id: 'quick-create', anchor: 'backlog.quick-create', requires: 'write', title: '…', body: '…' },
       { id: 'group-sort', anchor: 'backlog.group-sort', placement: 'below', title: '…', body: '…' },
     ],
   };
   ```

   Steps: stable `id`s (copy keys, i18n later), `requires: 'write' | 'owner' | 'admin'` for anything the user must be able to do (Viewers get the rest), `placement` as a preference only (the card flips or pushes to fit). Keep three to six steps and one or two sentences each.
2. **Catalogue**: add an entry to `TOUR_CATALOGUE` in `tours/tour-catalogue.ts` with `viewId`, `title` (same as the definition's), `load: () => import('./<area>.tours').then((m) => m.X_TOUR)` and, when the view needs at most a project, a `path` (`'/projects/:projectKey/<section>'`, or `'/search'` without a project) so the palette command can start the tour from anywhere. A tour for one audience sets `requires: 'owner' | 'admin'` on the entry as well as on every step (D-139): others get neither "Tour of this page" nor the command. The entry's `requires` is checked against the same access as the steps (what the view reports, else the open project), so a `write` or `owner` tour has no `path`. The `tours.spec.ts` check fails when the entry and the definition disagree.
3. **Anchors**: put `tkTourAnchor="<area>.<thing>"` on the element each step points at, **in every variant of the view and in every state that shows that part of the page** (the backlog puts `backlog.list` on the list and on both empty states). For one element out of a list, bind null on the others: `[tkTourAnchor]="row.id === firstId() ? 'backlog.rank' : null"`. An anchor that is only there with data (rows, "on boards") is fine: the step is skipped, with a dev-mode warning. If fewer than half of the tour's anchors resolve, the tour does not start, so make sure the frame of the page (header actions, toolbar, list or its empty state) always has its anchors.
   Sections added through `provideTicketDetailSection` and header actions put their own anchors in their own templates (`ticket.test-cases`, `ticket.delegate`), and only while they show.
   **The anchor rule (D-131)**: steps point at `tkTourAnchor` ids, never at CSS selectors or `data-testid`. An anchor id is part of the view's contract, like its view id: an A/B variant that has the feature exposes the same id, and one without it leaves it out (that step is skipped). Anchors must exist when the tour starts, so do not put them inside `@defer (on viewport)` blocks (the dashboard moved epic progress out of one, D-139).
4. **Access outside a project**: `requires` steps are decided from the open project's role. A view with no open project (a board, a ticket page) reports what the user may do there in its constructor, from the data it loaded: `inject(ViewTourAccess).provide(BOARD_VIEW.viewId, () => store.tourAccess())`, returning null while loading or when it does not apply (D-138). Instance Admin steps and tours (dmin.users) need nothing more: `admin` comes from the user's instance role everywhere.
5. **Version bump**: changing copy does not need one. Raise `version` when a tour gains steps users should see, so everyone who completed or dismissed the old version gets it as new again.
6. **Tests**: a Vitest plan test for the role filter and the empty-page case (see `tours/tours.spec.ts`), and a Playwright spec that seeds data through the API, starts the tour from the Help menu and walks it with the keyboard (`e2e/tests/onboarding/backlog-tour.spec.ts`). Assert step titles from the imported definition rather than copying them.
7. **Coverage (required)**: add a seeding recipe for the view id to `RECIPES` in `e2e/tests/onboarding/tour-anchors.spec.ts`. It seeds through the `Api` helper and returns the pages to open, one per state the tour has to work on (the dashboard lists an empty and a filled project). A page whose state leaves an anchor out by design returns `{ url, without: ['search.export'] }` (search in the Docs scope); the spec asserts those anchors are absent. The spec runs every `TOUR_CATALOGUE` entry as the bootstrap Admin, asserts every step's `[data-tour]` anchor is visible and that "Tour of this page" starts with every step. A catalogue entry without a recipe fails the spec. `app/tour-views.spec.ts` (Vitest) fails when a tour's view id is not routed through `viewRoute`, so a renamed view id breaks the build, not the tour.

Nothing else changes: "Tour of this page" enables itself on the view, and the palette gets `help.tour.<viewId>` ("Backlog tour"). Do not import `GuidedTours` statically into anything the initial bundle reaches; entry points import it lazily.

### Action-driven steps and walkthroughs

A walkthrough (`kind: 'walkthrough'`, D-142) spans pages and moves on when the user really does something. Its steps are the same `TourStep` data with a few more fields:

```ts
{
  id: 'create-board',
  anchor: 'boards.new',
  route: '/boards',                                            // the engine goes here first
  advanceWhen: { kind: 'condition', id: 'board.links-project' },  // or { kind: 'route', path }
  action: { label: 'Create the board', does: 'custom', id: 'create-board' }, // or click-anchor / focus-anchor
  waiting: 'Waiting for a board that links {projectKey}',     // {param} placeholders come from what was learnt
  optional: false,                                             // true adds "Skip this step"
  title: 'Create a board',
  body: '…',
}
```

- **Conditions live in code, not in the data.** The starter passes a `TourConditions` (`engine/tour-conditions.ts`) to `TourLauncher.start`: `check(id, params)` reads real data (a GET, never a store that only knows this tab) and returns `{ holds, params? }`; the params it learns (`ticketKey`, `boardId`) fill later routes and copy. `run(id, params)` performs `custom` actions (open a dialog with suggestions) and returns learnt params or null. `changes` says when to check again; `FirstProjectConditions` uses `ApiClient.writes` and window focus, and the engine adds navigation and "the user's dialog closed". Do not poll.
- **The step is non-modal.** No backdrop, shortcuts stay live, clicks pass through the hole only, and the card hides while the user's own dialog, picker or the peek is open. Put the step's anchor on what the user acts on, and give the step an `action` so Enter on the card does it.
- **Resume, don't repeat.** Start with `resume: {}` (or `{ skipOptional: true }`): the session checks the action steps in order and opens the first one not done (`resumeIndex`). Make every condition true for work done any other way (another dialog, a shortcut, REST, MCP), so a restart never asks for something the user already made.
- **Pause.** In a walkthrough a navigation the session did not start re-checks the step, then pauses behind the "Continue the walkthrough" pill when the user is off the step's page. `TourLauncher.paused()` and `continue()` expose it; Help items can use them.
- **Feature dialogs from core** go through a creator seam, like `TicketCreator`: `ProjectCreator.open(prefill)` and `BoardCreator.open(prefill)` load the feature dialog lazily through a token provided in `app.config.ts`.
- **Starting the walkthrough** from another feature: `startFirstProjectWalkthrough(injector, { skipOptional? })` from `core/onboarding/walkthrough/first-project.help.ts`, or run the Help item `help.tour.first-project` (`HelpMenuRegistry.find`), as the welcome dialog and `LearnActions` do.
- **Tests**: Vitest for the conditions with a stubbed `ApiClient` and for the resume rule (`walkthrough/first-project.spec.ts`), the engine behaviour with fake conditions (`engine/tour-session.walkthrough.spec.ts`), and one Playwright run of the whole walkthrough that asserts each step's anchor (`e2e/tests/onboarding/first-project.spec.ts`; the walkthrough is not in `TOUR_CATALOGUE`, so this spec is its anchor guard). `E2E_SCREENSHOTS=1` writes the step screenshots to `docs/screenshots/`.

## Adding a What's new entry

What's new (spec 14.2, D-140) is data; the dialog, the scheduling, Help → What's new and the e2e guard come for free.

1. **Append** an entry to `WHATS_NEW_ENTRIES` in `core/onboarding/guides/whats-new.ts` (oldest first, plain TypeScript):

   ```ts
   {
     id: 'whats-new.2027-02',      // always `whats-new.<date>`
     version: 1,                   // raise it to show the entry again to everyone who saw it
     date: '2027-02',              // the release month, yyyy-mm (UTC)
     title: 'Board swimlanes and saved filters',
     items: [
       { title: 'Swimlanes', body: 'Group a board by assignee or epic. Press S to switch.' },
       { title: 'Delegate to agent', body: '…', flag: 'agent.delegate' }, // hidden while the flag is off
     ],
   }
   ```

   Keep three to six items of one or two sentences each, describing what the user can do and where (a shortcut, a menu). Check each claim against the app; put `flag` on items behind a feature flag.
2. **Date it by the release month.** Users created after the first day of that month never see it; everyone else gets it once, the oldest unseen entry first and at most one auto-shown dialog per browser session (the welcome dialog wins). Help → What's new lists every entry, newest first.
3. **Tests**: `auto-dialogs.logic.spec.ts` checks every authored entry (id matches the date, valid month, at least one item, unique). The e2e guard picks the entry up through `AUTO_SHOWN_GUIDES`, so existing specs stay clear of it; `e2e/tests/onboarding/welcome.spec.ts` covers whichever entry is due.

The pieces: `OnboardingDialogs` (`core/onboarding/onboarding-dialogs.ts`, eager and small) decides once per app load which dialog opens by itself (`nextAutoDialog` in `auto-dialogs.logic.ts`); `OnboardingDialogRunner` and the dialogs (`core/onboarding/dialogs/`) are one lazy chunk. To wait for a tour without loading the engine, read `ActiveTour.id()`.

## Adding a feature flag

Flags are declared in the C# catalog first (backend.md "Adding a feature flag", D-169); the SPA only mirrors the keys.

1. **Declare it in the backend** with a description and a deliberate default (on or off). The Admin page lists it from the first start; nothing is created in the UI.
2. **Mirror the key** in `core/flags/flag-keys.ts`: one `export const MY_FLAG = 'my.flag';` and add it to the `FlagKey` union. `FeatureFlagService.isOn` / `variant`, `featureGuard`, `*tkFeature`, view definitions and What's new items accept only `FlagKey`, so a typo does not compile. `dotnet test` fails while the key is missing from the C# catalog.
3. **Read it** where the feature shows: `featureGuard(MY_FLAG)` on the route, `flags.isOn(MY_FLAG)` in a store or `computed`. Hide the whole feature (tabs, menu items, shortcuts) while it is off.
4. **Remove it** from `flag-keys.ts` together with every reader when the backend retires it.

## Tickets: shared services and extension points

The tickets slice (`features/tickets`, `features/backlog`) keeps everything other features need in `core/tickets/`, because features must not import each other.

| Need | Use |
| --- | --- |
| Ticket REST calls | `TicketsApi` (`get`, `create`, `update(key, patch, rowVersion?)`, `backlog`, `move`, `find`, `hints`, comments, links, history, `watchers` / `watch` / `unwatch`). Wire types are in `ticket.models.ts`. |
| Instant ticket views | `TicketCache.peek/fetch/prefetch(key)`. Lists call `prefetch` after a 150 ms hover, so the peek opens with data already loaded. |
| Keep lists in sync | `TicketEvents.events` emits `created`, `updated` (with the full ticket), `deleted` and `restored`. Emit them after your own ticket writes, and subscribe in list stores (backlog, boards) to patch rows without a refetch. |
| Delete a ticket | `TicketDeletion.delete(keys)`: no confirm dialog; emits `deleted` at once, runs the DELETEs, and shows a toast whose Undo calls `POST /tickets/{key}/restore` (10 minutes, D-82) and emits `restored`. |
| Move tickets | `MoveTargets.options(projectKey, currentLocation)` lists the backlog and the active boards linking the project as picker options; move with `TicketsApi.move`. Before a move, `MoveChildren.ask({ keys, from, childCounts, source, destination })` asks whether sub-tickets still in the place being left come along (TKT-71): no request when every loaded child count is 0, then `GET /tickets/move/children`, and a dialog only when that preview's `count` is above 0. It resolves `{ includeChildren, childKeys }` (send `includeChildren`, drop `childKeys` rows optimistically) or `null` on Cancel. The wording lives in the pure `move-children-prompt.ts`. |
| Open a ticket | `PeekService.open(key)` for the side panel, or route to `/tickets/:key`. |
| Create a ticket | `TicketCreator.open(prefill)` opens the create dialog with any `NewTicket` fields pre-filled, plus `heading` and an optional `submit(projectKey, ticket)` that replaces the default `POST /projects/{key}/tickets`. The regressions slice uses it for "Create bug" with its own endpoint. It resolves with the created `TicketSummary`, or `null`. The global `C` and the top bar button run the `ticket.create` command registered by `provideTicketCreation` in `app.config.ts`. In the backlog, `C` opens the inline quick-create row instead. |
| Assignee / label / version pickers | `ProjectPeople.picker(() => projectKey)` for a type-ahead `tkSearchPicker` over `GET /users?projectKey=` (any active user on public projects, Admins and Owner/Member members on private ones; never a members-only list), `FieldHints.get(projectKey, 'labels' \| 'version', prefix)`. |
| Project pickers | `ProjectDirectory` holds the first 1000 readable projects and says `capped()` beyond that (D-168), so never list it alone. A `tkSearchPicker` searches with `findProjects(directory, query)` and passes `[pickerHint]` `CAPPED_PROJECTS_HINT` while capped; a menu or inline list uses `injectProjectSearch(() => term)` with `pickerProjects(listed, term, results, chosen, accept)`, which keeps chosen projects listed. `resolveProject(directory, key)` finds a preset key beyond the cap. All in `core/projects/project-search.ts` (D-174). |
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

**Ticket header actions (extension point).** A feature adds a control to the ticket view's header bar (page and peek), before the watch and copy buttons, with `provideTicketHeaderAction({ id, order, loadComponent })` in `app.config.ts` (D-100). The component is lazily loaded inside `data-testid="ticket-action-<id>"` and receives the inputs `ticket` (the full `Ticket`) and `presentation` (`'page' | 'peek'`). It can inject the view's `TicketHeaderHost` to add `…` menu items (`setMenuItems(id, items)`, cleared on destroy; rendered as `ticket-menu-<item id>`), to register shortcuts only while `shortcutsActive()` is true, and to ask the view to reload the ticket and its history (`refresh()`) after a write of its own. Delegate to agent (`features/agent-delegation`) is the first user.

## Agent prompts: shared editor

The project Agent tab and the Admin prompts page edit the same kind of thing, so the pieces live outside both features (D-101):

| Need | Use |
| --- | --- |
| Wire types, clients | `core/agent/agent-prompt.models.ts`; `AgentPromptsClient` (`listProject`, `listInstance`, `getProject`, `getInstance`, `save(scope, slot, …)`, `resetProject`, `resetInstanceToBuiltIn`, `versions`, `version`, `restore`, `preview`, `placeholders`, and for Admins `instanceStatus`, `overrides(slot)`); `ProjectAgentSettingsClient` (`get`, `update(pk, patch, rowVersion)`). A scope is `{ kind: 'project', projectKey }` or `{ kind: 'instance' }`; a slot is a ticket type or `Guardrails`. |
| Editor state | `AgentPromptEditorStore` (`core/agent/`, provide it in the view): `open(scope, slot, sampleTicket?)`, `setEditable`, `setMode`, `edit(body)`, `setPreviewTicket`, `save`, `reset` (default or built-in), `markReviewed`, `restore(n)`, `loadVersions`, `version(n)`, `discard`, `reapplyLostEdit`. Signals: `document` (with `reference` = what "Compare" diffs against, `referenceChanged`, `raw` DTO), `mode`, `body`, `changeNote`, `dirty`, `canSave`, `preview`, `previewPending`, `issues`, `length`, `lengthEstimated`, `limit`, `lostEdit`, `versions`. |
| UI | `shared/agent-prompts/`: `tk-template-editor [(value)] [placeholders] [issues] [readonly] testId` (`{{` completion, issues underlined and listed), `tk-prompt-preview [prompt] [splitAt] [muted]="'after' \| 'before'" [mutedLabel]`, `tk-prompt-diff [left] [right] [leftLabel] [rightLabel]`, `tk-prompt-history [versions] [currentVersion] [canRestore] (view) (compare) (restore)`, `tk-length-meter [length] [limit] [estimated]`. Pure helpers: `line-diff.ts`, `template-text.ts`. |
| Leave guard | `unsavedChangesGuard` (`core/layout/`) on the route; the view implements `LeaveGuarded.confirmLeave()`. |
| Slots in URLs, page layout | `core/agent/prompt-slugs.ts` (`promptTypeSlug`, `promptSlotSlug`, `promptSlotFromSlug`, labels); `shared/agent-prompts/prompt-editor-page.scss` for the editor page grid both views use (D-103). |

## Docs: shared client and extension points

| Need | Use |
| --- | --- |
| Docs REST calls | `DocsApi` (`core/docs/docs.api.ts`): `tree`, `recent`, `trash`, `get`, `create`, `rename`, `move`, `duplicate`, `delete`, `restore`, plus the content calls below. Wire types in `doc.models.ts` (`Doc`, `DocTreeItem`, `DocSummary`, `DocTrashItem`, `DocPlacement`, `DOC_TREE_LIMITS`). |
| Doc links | `docUrl(key, title)` → `/projects/{PK}/docs/{KEY}/{slug}`, `docSlug` (same as the server's `DocPaths.Slug`), `docsHomeUrl`, `docPathSegments(path)`, `projectKeyOfDoc`, `DOC_KEY_PATTERN` (`shared/domain/keys.ts`). |
| The tree inside the Docs section | `DocTreeStore` (`features/docs/tree/`, provided by `docs.layout`): `items`, `rows`, `canWrite`, `canManageTrash`, `activeKey`, `cursorKey`, `startCreate(kind, parent)`, `startRename`, `move`, `duplicate`, `delete` (Undo toast), `restore`, `patchFromDoc(doc)` after a write, `structureVersion` (bumped after renames and moves). Pure rules in `doc-tree-logic.ts`. |
| The open doc | `DocStore` (`features/docs/doc/`, provided by the `docs.doc` frame): `doc`, `status`, `load`, `refresh`, `set(doc)` after a write. |
| A content view for a doc kind | Change the loader of `DOCS_PAGE_VIEW`, `DOCS_DIAGRAM_VIEW` or `DOCS_FOLDER_VIEW` in `features/docs/docs.views.ts` (or add a flagged variant). The component takes `doc = input.required<Doc>()` and renders below the page bar. With `?mode=edit` (writers, docs for which `hasDocEditor(doc)` is true: pages, and diagrams whose format has an entry in `DIAGRAM_EDIT_VIEWS`) the frame hides its page bar and the content view renders its editor; `E` and the Edit button set it. |
| A diagram format | `docs.diagram` (`features/docs/diagram/diagram.view.ts`) serves every format (Mermaid, Canvas). Add a renderer to `DIAGRAM_RENDERERS` (`diagram-renderers.ts`: `({ key, version, content, snapshotUrl? }, theme) => Promise<{ element, width, height, exported? } \| { error, notice? }>`, used by the view's zoom/fit viewport and by page embeds; `notice` is a neutral message such as "Preview not rendered yet"; `exported` is a picture the browser made that the view stores for writers) and an editor view to `DIAGRAM_EDIT_VIEWS` (`docs.views.ts`; it gets `doc` and owns its edit bar: reuse `DocEditSession`, `tk-doc-edit-status`, `tk-doc-conflict`). The viewport (`tk-diagram-viewport [content] [fill] [stale]`) takes any element with its natural size. `isDiagramEmpty(format, content)` decides the empty state. |
| Canvas pictures (D-124) | `renderCanvas` / `canvasRenderer(exporter)` and `loadPicture(src, theme)` (`features/docs/diagram/canvas/canvas-renderer.ts`): the stored SVG in an `<img>` (dark: `CANVAS_DARK_FILTER`), else an export in the browser. `tk-canvas-picture [source] [fill]` shows one version without the view's chrome (history comparison, conflict view). `DocsApi.storeSnapshot(key, n, svg)` fills a version that has none. |
| Draft banner, editor status line | `tk-doc-draft-banner [doc] (continue)` (`features/docs/doc/`) and `tk-doc-edit-status [editors]` (`features/docs/editing/`, reads the injected `DocEditSession`). |
| Page content, drafts, versions | `DocsApi.update(key, { title?, content, baseVersion, changeNote })`, `draft`, `saveDraft`, `saveDraftOnUnload` (keepalive), `discardDraft`, `version(key, n)`, `markdownExportUrl`. Page attachments: `DocAttachmentsApi` (`core/docs/doc-attachments.api.ts`: `list`, `upload`, `delete`, `changes`, `markdownFor`). |
| Editing a doc's text | `DocEditSession` (`features/docs/editing/`, provide it in the editor component): `open(doc)`, `edit({ title?, content? })` (autosave 1 s later), `flush()`, `saveOnUnload()`, `publish(note)` (merges on `doc.version.conflict`), `conflict`, `keepEditingOnLatest`, `overwriteWithMine`, `discard`, `status`, `revision` (reload the editor text when it changes), `configure({ textMerge: false, attach })` for formats without a line merge and for extra publish fields (Canvas: the conflict view without "Keep editing on latest", the picture with every publish; `tk-doc-conflict [textual]="false"` projects `[theirs]` and `[mine]`). `mergeThreeWay(base, mine, theirs)` is the pure merge; `createMarkdownEditor` and helpers (`insertBlock`, `wrap`, `prefixLines`, `replaceDocument`) wrap CodeMirror. |
| Rendering a doc's markdown | `tk-doc-markdown` (`features/docs/page/`): heading anchors, callouts, code headers, highlighting and the registered enhancers; `rendered` emits the host after each render. Measured as `performance` entry `tk-doc-markdown`. Pass `[references]="doc.references"` and `[embeds]="doc.embeds"` for ticket chips, doc links and diagram embeds (D-119); they re-render only when their content changes, not on every refetch. |
| Doc links and mentions | `Doc.references` / `embeds` / `backlinks` come with the doc GET. `DocMentionsApi.forTicket(key)` (`core/docs/doc-mentions.api.ts`) lists a ticket's docs. `docLocation(path, projectKey, currentProjectKey)` formats where a listed doc lives. Embeds render as `figure.tk-doc-embed[data-doc-key][data-diagram-format][data-version]` with an empty `.tk-doc-embed-body` (min-height 160 px) for a diagram enhancer to fill; the readable embeds are in `DocMarkdownContext.embeds`. |
| A section in the page reader | `provideDocPageSection({ id, order, placement: 'footer' \| 'rail', kinds?, loadComponent })` (`core/docs/doc-extensions.ts`) in the `providers` of `docs.routes.ts`. The component takes `doc = input.required<Doc>()`, is re-created per doc key and renders its own `h2` (copy the attachments section's `sec-h`/`box` look). Footer sections sit below the content (tickets mentioned at 20, linked from at 30, attachments at order 50, pages only; comments at order 90, pages and diagrams), rail sections below "On this page" (in the rail from 1440 px, otherwise in the page bar popover; created only while shown, D-122). `kinds` limits a section to some doc kinds; diagram views render the footer sections too (D-117). A section with nothing to show sets the host class `tk-section-empty` and takes no space (D-119). |
| Post-processing rendered markdown (Mermaid, embeds) | `provideDocMarkdownEnhancer({ id, order, enhance(host, { mode, theme, docKey, signal }) })`. It runs after every render in the reader (`mode: 'view'`) and the editor preview (`'preview'`, re-rendered while typing) and after a theme change (the HTML is set again first). Replace descendants only; drop async work once `signal` is aborted. |
| An action in the page bar from a content view | Inject `DocBarSlot` (`features/docs/doc/`, provided by the `docs.doc` frame) and call `set(templateRef)`; call the returned function to remove it. The frame renders it first on the right side of the bar (the page reader's "On this page" button, D-122). |
| History, old versions, restore | `?history=n[&with=m]` renders `DOCS_HISTORY_VIEW` and `?v=n` `DOCS_VERSION_VIEW` in place of the content view (the frame hides its page bar for history; `H` toggles it). `DocHistoryApi` (`core/docs/doc-history.api.ts`: `history(key, cursor)`, `restore(key, n)`); `DocRestoreAction` (confirm, restore, update `DocStore` and the tree); `diffDocs(old, new)` / `toSplitRows` in `features/docs/history/doc-diff.ts` (lazy chunk with jsdiff, measured as `tk-doc-diff`). Rendering a version reuses the kind's content view with the doc as of that version and no write permissions, so diagram views render old versions without extra work; a new activity action gets its history line in `describeActivity` (`history-items.ts`). |
| Toolbar buttons, `/` commands, CodeMirror extensions | `provideDocEditorPlugin({ id, order, toolbar?, slashCommands?, extensions? })`. Actions get a `DocEditorCommandContext` (`selectedText`, `replaceSelection`, `insertBlock`, `focus`, `docKey`, `projectKey`, `injector` for dialogs that need the docs layout's stores); register extra icons with `provideIcons` next to the plugin. `extensions(context)` returns CodeMirror `Extension`s and is loaded with the editor chunk. Pass a factory (`provideDocEditorPlugin(() => { const api = inject(X); return { … }; })`) to use services. Completion sources go in through the `markdownCompletions` facet (`editing/codemirror-markdown.ts`), since the editor's `autocompletion` overrides language-data sources; the `[[` doc picker and `#` ticket picker (`page/links/`) are the examples. |

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
| `tk-avatar [userId] [name] [size]`, `tk-user [user]` | The user's chosen animal icon (by `userId`, through `AVATAR_SOURCE`), else initials; on the chosen palette colour, else a stable tint hashed from the id. `data-avatar-icon` carries the drawn icon key. No user shows "Unassigned"; inactive users show "(deactivated)". |
| `tk-project-tile [projectKey]` | 16 px coloured key tile. |
| `tk-user-card [user] [self] [achievements] [trapFocus] (navigated)` | The user card's presentation (layout-and-screens §2 "User card"): 32 px avatar, name (never the email), "You" on your own card, and the "Shared achievements" / "Shared by you" section only while there is something to show; the medal list is a `@defer` chunk. `achievements` is a `SharedMedalsState` (`off`, `loading`, `hidden`, `loaded`); the rules are `userCardSection` / `showManageLink` in `user-card.logic.ts`. Features open it through `tkUserCard` (core), which fetches the data. |
| `tk-achievement-medal [achievementId] [icon] [tier] [tierCount] [size] [label] [shared]` | Hexagon medal (design-system "Achievement medal"): tinted from `--tk-palette-{fnv(id) mod 8}`, the catalogue's kebab-case Tabler `icon` (registered in `MEDAL_GLYPHS`), a ring in `--tk-tier-*` and one pip per `tier` (sizes 64, 48, 32; 20 has no pips, so write the tier next to it); `tier` 0 is the dashed locked state, `tierCount` 1 a one-time medal. Decorative unless `label` is set (`role="img"`). Copy helpers in `achievement-medal.logic.ts`: `tierText`, `tierName`, `tierColor`, `progressText`, `medalLabel` (the "name, tier" accessible name, "…, shared" for the owner), `sharedTierCount(id)` (one-time ids in `ONE_TIME_ACHIEVEMENTS`). `shared` draws the owner-only shared marker. |
| `tk-skeleton-rows [count]` | Row skeletons. They appear only after 120 ms. |
| `tk-empty-state icon title description` + projected actions | Empty and error states. `tone="danger"` for errors. |
| `tk-hint title body [learnMoreLabel] [compact] (dismissed) (learnMore)` | Inline hint (`role="note"`, info tint): presentational only. Features place hints through `tk-contextual-hint` (core), which decides visibility. |
| `tk-segmented [options] [(value)]` | Radio-group segmented control. |
| `[tkSearchPicker]="searchFn" (picked)` | Like the inline picker, but options come from an async, debounced search (tickets by key or title). `pickerHint` shows a note while nothing is typed; Enter before the results arrive picks the first match. |
| `[tkLabelsPicker]="labels" [labelSuggestions]="fn" (labelToggled)` | Multi-select labels popover with suggestions and "create new". Stays open while toggling. |
| `[tkInlinePicker]="options" [pickerValue] (picked)` | CDK overlay listbox with a filter input, ↑/↓/Home/End/Enter/Esc and digits 1–9. Options may carry an `icon` (status, type, priority, severity glyph or a Tabler icon). `[pickerLoad]` loads options on open; `open(origin, options)` opens under another element. Optional `[pickerOptionTemplate]`, and `[pickerFooter]` (a template rendered under the options, e.g. a hint). Ready-made options are in `shared/domain/picker-options.ts`. |
| `tk-markdown [source] [mentions]` | `renderMarkdown(source, { mentions })`: marked (GFM) → raw HTML escaped → DOMPurify, ticket keys linked to `/tickets/KEY` and doc keys (also `[text](KEY)`, `![caption](KEY)`) to `/docs/KEY` (router navigation), external links open in a new tab. With `references` (docs) known tickets become status chips, known docs title-linked, diagram embeds figures and anything else plain text (`shared/markdown/link-references.ts`). Mention tokens `@[Name](user:<id>)` (D-96) of the users in `mentions` become `.tk-mention` chips (16 px avatar, the chosen icon and colour through the `avatarOf` option, else initials on the user's stable tint, + current display name, `data-testid="mention-<id>"`), built with DOM APIs after sanitizing; any other token shows as plain `@Name`. Tokens in code stay code. Parser and caret helpers: `shared/markdown/mentions.ts`. |
| `tk-markdown-editor [(value)] (submitted) (cancelled) [mentionSearch] [mentions]` | Write / Preview tabs. Ctrl/⌘+Enter submits and Esc cancels. Projected content goes in the footer. With `mentionSearch: (query, signal) => Promise<MentionCandidate[]>`, an `@` at a word start opens a people listbox at the caret (CDK overlay placed with a mirror div, `data-testid="mention-picker"`, rows `mention-option-<email>`): 150 ms debounce, the previous search aborted, at most 8 rows, "No one matches". ↑/↓ move, Enter or Tab insert the token, Esc closes only the picker; with nothing to pick, Enter and Tab keep their usual meaning. `mentions` (users already mentioned) lets Preview show chips. Offer it only on ticket descriptions and comments (D-96). |
| `tk-route-tabs [tabs]` | Material tab nav bar over child routes. Project the `<router-outlet />`. |
| `tk-kbd`, `relativeTime` / `absoluteTime` pipes | Keyboard hints; "3h ago" / "Oct 22". |
| `shared/domain/enums.ts` | Every spec §3 enum as a const array, a union type and a `*_LABELS` map, plus `statusCategory()`. `keys.ts` holds the key regexes. |

### Diagrams (`shared/diagrams`, ADR 0014)

Mermaid, Excalidraw and React are lazy chunks. Never import `mermaid`, `@excalidraw/excalidraw`, `react` or `react-dom` statically from app code; go through these entry points:

| API | Notes |
| --- | --- |
| `renderMermaid(source, theme)` → `{ svg }` or `{ error }` | Loads Mermaid on first use with `mermaidConfig(theme)`: strict security, SVG labels, dagre, token palette. The SVG is DOMPurify-sanitised; the error is the parser message. Renders are serialised and the last 64 are cached per source and theme (`cachedMermaid`). `mermaidDiagramType(source)` gives the label (`flowchart`, `sequence`, `ER` …); `SUPPORTED_MERMAID_TYPES` lists the promised types. |
| `renderMermaidBlocks(root, theme, { lazy?, signal?, lastGood? })` (`mermaid-blocks.ts`) | Replaces every `pre > code.language-mermaid` under `root` (as `renderMarkdown` emits them) with `figure.tk-mermaid`. Lazily by default: each block waits for `whenVisible` (one shared IntersectionObserver) as a skeleton of its remembered height (`diagram-heights.ts`) or `estimateMermaidHeight`; cached renders are placed synchronously. A block that fails to parse stays as code, followed by `.tk-mermaid-error` (`mermaidErrorBox`); with `lastGood` (editor preview) its last good SVG stays, dimmed. Run it after the HTML is in the DOM, and again when the theme changes; abort `signal` when the HTML is replaced. `tk-markdown` and the docs enhancer call it; the PDF print bundle calls it with `'light'` and `lazy: false`. |
| `DIAGRAM_THEME` (`diagram-theme.token.ts`) | The on-screen theme as a signal for `shared/` code; the app config provides it from `ThemeService`. |
| `MERMAID_SECURITY_SAMPLES`, `unsafeSvgFindings(svg)` | Hostile sources and the checker for unit tests. `mermaid-renderer.spec.ts` shows how to render in jsdom (stub `getBBox` and `getComputedTextLength`). |
| `tk-canvas-editor [source] [theme] [readOnly] (changed) (loadFailed) (imageRefused)` | Excalidraw island. `source` is the stored JSON; a new value reloads the editor, so never bind the editor's own output back into it. `ready()` turns true once mounted; then `serialize()` returns the JSON to store and `exportSvg()` the light snapshot. Give the host a height. Pasted and dropped images are refused (`imageRefused`). The host carries `data-own-keys` (`OWN_KEYS_ATTR`): while it is shown `ShortcutService` treats its focus and the body like a text field, so only `allowInInputs` shortcuts fire. |
| `parseCanvasSource`, `emptyCanvasSource`, `exportCanvasSourceSvg(source)` | Stored-format helpers; the last one exports a snapshot without mounting an editor (it still loads Excalidraw). |
| `loadExcalidraw()` | React, react-dom and Excalidraw, with `EXCALIDRAW_ASSET_PATH` pointing at `/excalidraw/` (fonts and CSS copied by `angular.json`). |

**PDF print bundle** (`src/print/`, D-111, D-127): `npm run build:print` bundles `print-main.ts` with esbuild into `dist/print` (one classic script plus `print.css` and fonts). It may import only Angular-free code from `@shared` (ESLint and the build both check; the build fails on Angular, React or Excalidraw). `print-document.ts` turns the API's `PrintData` (`print-data.ts`) into the page; change both sides together with `DocPrint` in the API. Anything `renderMarkdown` renders (callouts, chips, embeds) prints automatically; give new elements print-safe styles in `print.scss`. Downloads go through `DocExports` (`core/docs/doc-export.ts`): `export({ key, title, kind, version })`, one per doc at a time, folders in the background with a ready toast.

Embed a Canvas in a page through its stored snapshot in an `<img>` (`renderCanvas`), not through a read-only editor. In dark mode add `filter: invert(93%) hue-rotate(180deg)`. Excalidraw logs about 230 CSP reports for its `esm.sh` font fallback when it mounts. They are expected; no request is sent.

Global CSS helpers (`styles/`): `.tk-page`, `.tk-page-header` (+ `.tk-page-count`, `.tk-page-actions`), `.tk-toolbar`, `.tk-page-body`, `.tk-icon-btn`, `.tk-field-label` (labels sit above fields, no floating labels), `.tk-callout[-danger|-warning]`, `.tk-popover`, `.tnum`, `.tk-muted`, `.tk-subtle`.

## Theming

`styles/_tokens.scss` is the single source of truth for design tokens; the design docs link to it and there is no copy to keep in sync. The HTML mockups embed an older snapshot and are visual reference only. `_material-theme.scss` maps every M3 system token to a `--tk-*` variable (`mat.theme` + `mat.theme-overrides`, verified against the installed Material 22.2). `_material-overrides.scss` pins component sizes: 32 px controls, 28 px icon buttons, 32 px table rows, no ripples. Wrap toolbars in `.tk-dense` for 28 px controls. Components use semantic tokens only (`--tk-bg`, `--tk-text-muted`, `--tk-status-*`), never primitives, so dark mode works without extra code. Buttons: `mat-flat-button` is primary (at most one per view), `mat-stroked-button` secondary, `mat-button` ghost.

## Testing

- **Unit (Vitest + TestBed, zoneless)**: `*.spec.ts` next to the code. Write them Arrange / Act / Assert. Wall-clock budgets go in `*.perf.spec.ts`: `npm test` excludes them so it stays deterministic under load, `npm run test:perf` runs them (alone, on an idle machine). The current suite covers flag bucketing (shared vectors), view registry resolution and fallback, markdown sanitizing and key autolinks, auth guards, ApiError mapping and shortcuts.
- **E2E (`e2e/`, Playwright 1.64)**: `npm install && npx playwright install chromium`, then `npm run typecheck` (`tsc --noEmit`; Playwright only strips types, so type errors would otherwise go unnoticed) and `npm test`. It runs against an already running stack (`E2E_BASE_URL`, default `http://localhost:8080`, i.e. docker compose web → api; use `http://localhost:4200` with `ng serve`). The `setup` project signs in as the bootstrap admin (`E2E_ADMIN_EMAIL` / `E2E_ADMIN_PASSWORD`, falling back to `TICKETING_BOOTSTRAP_ADMIN_*`, default `admin@ticketing.local` / `ChangeMe-Admin-2026!`) and saves `.auth/admin.json`, so specs start signed in. To test anonymously, use `test.use({ storageState: { cookies: [], origins: [] } })`.
  - Import `test` and `expect` from `e2e/support/fixtures.ts`. It provides page objects (`loginPage`, `shell`) and `api`.
  - `api` (`e2e/support/api.ts`) uses the admin cookie session and handles XSRF itself (it reads the `XSRF-TOKEN` cookie and echoes it as `X-XSRF-TOKEN`). Seed data through it (`api.createProject()`, `api.post(...)`), never through the UI. Use `uniqueProjectKey()` so parallel tests don't collide.
  - Page objects live in `e2e/pages/*.page.ts`. They expose locators and intent-level methods, never assertions about business rules.
  - **Other users**: seed them with `seedUser(api, prefix)` (`e2e/tests/identity/identity.ts`) and sign them in with `signInAs(browser, { email, password: PASSWORD })` (`e2e/support/session.ts`). It returns `{ context, page }` with no page loaded yet (stub routes or add init scripts, then `page.goto`), signed in through the API.
  - **Auto-shown guides (D-134)**: the welcome dialog, What's new and hints would cover what a spec drives, so `global.setup.ts` and `signInAs` mark every auto-shown guide `Completed` before the SPA loads (`markGuidesSeen(request, guides?)` in `e2e/support/guides.ts`; `markGuidesSeenAs(credentials)` for a user who must sign in through the login form). An onboarding spec that wants them opts in with `signInAs(browser, credentials, { keepGuides: true })`, or marks only some with `markGuidesSeen(context.request, [guide])`. The list is `AUTO_SHOWN_GUIDES` in `web/src/app/core/onboarding/auto-guides.ts`: **every guide that opens or appears by itself must be listed there** (through `guides/welcome.ts`, `guides/whats-new.ts` or `guides/hints.ts`), or the suite will meet it. `e2e/tests/onboarding/guide-guard.spec.ts` checks the guard. The welcome dialog and What's new open by themselves at most once per browser session (D-140), so a spec that wants one of them marks the other auto-shown guides seen (see `signInWithDialogs` in `e2e/tests/onboarding/welcome.spec.ts`).
  - **Importing SPA data**: `e2e/tsconfig.json` maps `@onboarding/*` to `web/src/app/core/onboarding/*` (Playwright honours tsconfig `paths`), e.g. `import { AUTO_SHOWN_GUIDES } from '@onboarding/auto-guides'`. Files imported this way (guide lists, tour definitions in `tours/`, `onboarding.models.ts`) must stay plain TypeScript: no Angular or other package imports, relative imports only.
  - **Toasts**: one shows at a time, but the one leaving and the one arriving overlap during the animation, and an achievement unlock can follow yours. Assert on a toast filtered by its text, `page.getByTestId('toast').filter({ hasText: 'Restored' })`, never on `getByTestId('toast')` alone.
  - **Under load**: a full parallel run against a local docker stack meets stalls of several seconds, so the suite runs with a 60 s test and 10 s expect timeout, and Chromium runs its network service in-process (a killed network service process hung every later call, D-161). Before a reload or a new page, wait for what the server must have stored (`expect.poll` on the API), not only for the optimistic UI.
  - **Sign-in rate limit (D-167)**: production allows 20 sign-in and set-password requests per minute per client IP, and the suite makes hundreds from one address. Run it against a stack started with `docker-compose.override.yml` (`docker compose up --build` loads it; with your own project name and ports: `WEB_HOST_PORT=18083 API_HOST_PORT=15083 DB_HOST_PORT=15433 docker compose -p <name> up -d --build`), which raises the limit to `TICKETING_LOGIN_PERMITS_PER_MINUTE` (default 2000). A stack from `-f docker-compose.yml` alone keeps 20 and fails with 429 `rateLimited`. No spec relies on the raised value; abuse protection is covered by the integration tests.
  - **Shared stack data**: specs run in parallel on one database, so a spec about an empty list cannot expect the list to be empty. Filter what the browser sees to the test user's own data (`page.route` around the real response, see `showOnlyOwnData` in `e2e/tests/onboarding/first-project.spec.ts`) rather than skipping.
  - Timing budgets go in `*.perf.spec.ts`. The `chromium` project ignores them; the `perf` project runs them only when asked, alone: `E2E_PERF=1 npx playwright test --project=perf` (parallel workers skew the numbers).

### `data-testid` conventions

Use `getByTestId` (configured to `data-testid`) for anything the e2e tests drive; use roles and labels for accessibility assertions.

- kebab-case, `<area>-<element>`: `login-email`, `login-submit`, `topbar`, `sidebar`, `user-menu`, `menu-logout`, `theme-toggle`, `palette-trigger`, `command-palette-input`, `peek-panel`, `toast`.
- Sidebar links: `nav-<target>` (`nav-my-work`, `nav-project-PAY`, `nav-project-backlog`, `nav-admin-flags`). Project tabs: `project-tab-<path>`.
- Every routed view host: `view-<viewId>` (`view-backlog.list`), so a test can wait for the page.
- Repeated items: `<thing>-row-<stable key>` (`project-row-PAY`). Use the business key, never an index.
- Hints: `hint-<name>` (`hint-free-transitions`) on the hint itself, its dismiss button `hint-dismiss`.
- Palette items: `palette-item-<id>`. Help menu items: the item id with dots as dashes (`help-shortcuts`, `help-restart-guides`); the trigger keeps `shortcut-help`. Segmented options: `<testId>-<value>`.
- Test ids are part of the e2e contract: keep them when you refactor markup, and don't put them on purely visual elements.
