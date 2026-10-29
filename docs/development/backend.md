# Backend development guide

The backend is a .NET 10 solution (`Ticketing.slnx`) laid out as in [the architecture overview](../architecture/overview.md). The REST contract is in [api-conventions.md](../architecture/api-conventions.md). The domain rules are in [the spec](../product/01-refined-spec.md).

## Build, run, test

Prerequisites: .NET SDK 10.0.300 or newer, and Docker (Rancher Desktop in dockerd/moby mode). Docker is needed for the integration tests and for compose.

```bash
dotnet build                        # warnings are errors
dotnet test                         # domain unit tests + integration tests (spins up PostgreSQL 18 via Testcontainers)
dotnet test --project tests/Ticketing.Domain.Tests   # fast tests only
```

Run the API locally against a compose database:

```bash
cp .env.example .env                # once; holds DB password, bootstrap admin and ports (required by compose)
docker compose up -d db             # PostgreSQL on localhost:5433 (published by docker-compose.override.yml)
dotnet run --project src/Ticketing.Api   # http://localhost:5080, Development settings
```

Or run everything in containers: `docker compose up --build db api`. The API is then also on http://localhost:5080 (published by `docker-compose.override.yml` only; `docker compose -f docker-compose.yml up` publishes just `web`). `web` (nginx + SPA, port 8080) is built from `./web`.

`docker-compose.override.yml` holds development-only additions: it publishes the database port, and compose loads it automatically. On a server, start only the base file so the database stays private to the compose network:

```bash
docker compose -f docker-compose.yml up -d --build
```

| URL | What |
| --- | --- |
| `/api/v1/...` | REST API |
| `/api/v1/openapi.json` | OpenAPI document (needs a cookie or PAT in Production) |
| `/scalar` | API reference UI (not in Production) |
| `/mcp` | MCP server (PAT only) |
| `/health/live`, `/health/ready` | Liveness; readiness (database reachable) |

Configuration (environment variables override `appsettings*.json`):

| Setting | Meaning |
| --- | --- |
| `ConnectionStrings__Db` | PostgreSQL connection string |
| `TICKETING_BOOTSTRAP_ADMIN_EMAIL`, `TICKETING_BOOTSTRAP_ADMIN_PASSWORD` (`_NAME` optional) | First Admin, created at startup while the user table is empty. Startup fails if they are missing then. |
| `Database__MigrateOnStartup` | Apply migrations at startup (default true) |
| `Auth__CookieSecurePolicy` | `Always` (default) or `SameAsRequest` (Development, compose over plain HTTP) |
| `RateLimiting__PatPermitsPerMinute` | Per-token rate limit (default 600) |
| `RateLimiting__LoginPermitsPerMinute` | `POST /auth/login` attempts per client IP (default 20) |
| `ForwardedHeaders__KnownNetworks` | Comma-separated CIDR ranges of proxies whose `X-Forwarded-For`/`-Proto` are believed (compose: `TICKETING_TRUSTED_PROXIES`, default Docker's private pools). Loopback is always trusted. |
| `ForwardedHeaders__ForwardLimit` | Proxy hops to unwrap (default 1 = nginx; 2 with a TLS proxy in front, whose address must then be trusted too) |
| `TICKETING_PUBLIC_URL` | This instance's public origin, for example `http://localhost:8090`. Agent prompts build `{{instance.url}}` and `{{ticket.url}}` from it, never from request headers ([spec §13.4](../product/01-refined-spec.md#134-template-language)). While it is unset, agent delegation is off for everyone (`agent.disabled`, [spec §13.2](../product/01-refined-spec.md#132-feature-flag)); a value that is not an absolute http(s) URL stops startup. Compose passes it from `.env`; `appsettings.Development.json` sets `http://localhost:4200` for `ng serve`. |
| `TICKETING_SEED_DEMO` | `true` seeds [demo data](#demo-data) at startup into a workspace without projects (default false; development and demos only) |
| `TICKETING_DEMO_PASSWORD` | Password of the demo users (12+ characters, not a common password); without it their set-password links are logged |
| `Pdf__Password` | Basic-auth password of the PDF renderer (compose: `PDF_RENDERER_PASSWORD`, shared with the `pdf` service). Empty: PDF export answers 503 `doc.export.unavailable` and the `pdf` container idles. |
| `Pdf__Url`, `Pdf__Username` | Gotenberg (default `http://pdf:3000`, `ticketing`) |
| `Pdf__BundlePath` | The print bundle (`print.js`, `print.css`, fonts); `/app/print` in the image, `../../web/dist/print` in Development |
| `Pdf__WarmUp` | Render a small page after startup so the first export is fast (default true) |
| `AchievementProjector__Interval` | Time between achievement projector cycles (default `00:00:15`; compose: `TICKETING_ACHIEVEMENTS_INTERVAL`). e2e runs lower it so an unlock shows within seconds ([spec §15.8](../product/01-refined-spec.md#158-projector)). |
| `AchievementProjector__Enabled`, `AchievementProjector__SweepAtUtc` | Run the projector in this instance (default true; integration tests turn it off and call `AchievementProjection` directly); time of day (UTC) of the nightly safety sweep (default `03:00`) |

Logs are JSON on the console (`simple` in Development).

### PDF export (D-111, D-127)

The API image builds the print bundle in a Node stage (`npm run build:print` → `/app/print`) and posts exports to the `pdf` service (Gotenberg 8.39 Chromium) on the internal `render` network, which has no egress and no published port. To try exports with `dotnet run`, build the bundle once (`cd web && npm run build:print`), start a renderer and pass the same password:

```bash
docker run --rm -p 127.0.0.1:3010:3000 -e GOTENBERG_API_BASIC_AUTH_USERNAME=ticketing -e GOTENBERG_API_BASIC_AUTH_PASSWORD=dev-pdf \
  gotenberg/gotenberg:8.39.0-chromium gotenberg --api-enable-basic-auth --chromium-allow-list='^file:///tmp/.*' --chromium-deny-public-ips --chromium-deny-private-ips
Pdf__Password=dev-pdf dotnet run --project src/Ticketing.Api      # Development points Pdf__Url at localhost:3010
```

**Upgrading an existing installation**: add `PDF_RENDERER_PASSWORD=<long random value>` to `.env` (see `.env.example`), then `docker compose up -d --build`. Without it the stack still starts and only PDF export is off. Integration tests replace the renderer with `FakePdfRenderer` (assert on the posted bundle); `DocExportGotenbergTests` runs the real one when `TICKETING_PDF_TESTS=1` (trait `Category=Pdf`, needs the built bundle).

## Demo data

For development, screenshots and demos only, never on a real installation. The seeder fills an empty workspace with a believable twelve-week history:

- 6 users (`maya.kowalczyk`, `daniel.okafor`, `sofia.lindqvist`, `tomasz.nowak`, `priya.raman`, `lucas.moreau`, all `@example.com`).
- 3 projects with members: `PAY` Payments (public), `WEB` Web App (public) and `OPS` Platform Ops (private; Tomasz is not a member, Priya is a viewer).
- 180 tickets: 17 epics with stories, technical tasks, bugs and spikes (up to 3 levels), markdown descriptions, labels, versions 1.3.0 to 1.6.0, priorities, severities, points, assignees, comments and links (including cross-project ones). Every status is used; Done tickets carry resolutions.
- Boards `Sprint 42` (PAY + WEB) and `Ops Kanban` (OPS).
- 26 test cases (Manual, Automatic and New) and two PAY regression sessions: `Release 1.4.0` (completed, one failed item with its bug) and `Release 1.5.0` (in progress).
- 3 feature flags.
- A docs tree per project (24 docs): two folders, four pages with callouts, tables, code, ticket mentions and doc links, a Mermaid and a Canvas diagram embedded in a page (the Canvas with its picture, so PDF export prints it), later versions with change notes and 8 page comments (D-128).

Trigger it explicitly, in either way:

```bash
# At startup (compose: set it in .env and pass it to the api service)
TICKETING_SEED_DEMO=true TICKETING_DEMO_PASSWORD='Demo-Password-2026' dotnet run --project src/Ticketing.Api

# One-off command: migrates, creates the bootstrap admin if needed, seeds and exits
dotnet Ticketing.Api.dll seed-demo                      # published API
docker compose run --rm api seed-demo                  # in compose
```

Rules:

- It runs only while the database has **no project** (deleted ones included), so it never touches real data and a second run is a no-op. It takes a PostgreSQL advisory lock, so several instances starting together seed once.
- It needs an active Admin (the bootstrap admin) and acts as the demo users through the real use cases (`DemoData/DemoWorkspace.cs`): ticket keys, ranks, hierarchy rules, activity history, board moves, regression snapshots, doc versions and the doc reference index are all genuine.
- Timestamps are backdated over the last 12 weeks (working hours, weekdays) by a controllable clock. The seeder builds its own service provider with the application and infrastructure registrations, a `TimeProvider` it sets before each call and an `ICurrentUser` for the acting user. The plan uses a fixed random seed (`DemoScript.RandomSeed`); dates are relative to the moment of seeding, so dashboards always show recent activity.
- Without `TICKETING_DEMO_PASSWORD` each demo user gets a set-password link (valid 24 hours) written to the log as a warning; open `<web origin>/set-password?token=...`.
- Content lives in `src/Ticketing.Api/DemoData/DemoContent.cs` (titles, hand-written descriptions, test cases, cross links) and `DemoTexts.cs` (generated descriptions and comments); docs in `DemoDocs.cs` (content written with `IDemoDocRefs`, so ticket and doc keys are real; each doc, version and comment is scheduled after what it mentions) and `DemoCanvas.cs` (boxes and arrows as an Excalidraw scene plus its SVG picture). `tests/Ticketing.IntegrationTests/DemoData` checks the counts, idempotency and the PAY dashboard.

## Where things live

```
src/Ticketing.Domain/<Feature>/          entities, enums, <Feature>Errors (stable error codes), pure rules
src/Ticketing.Application/<Feature>/     one file per use case; DTOs
src/Ticketing.Application/Abstractions/  ICurrentUser, ITicketingDbContext, IClock, IActivityLog, IProjectCounters,
                                         ITicketRanker, IIdempotency, IAttachmentStore, IFeatureFlagStore, ...
src/Ticketing.Application/Access/        IProjectAccess (spec 5.1), credential checks
src/Ticketing.Application/Common/        AppException, Validator, paging, Optional<T>, concurrency
src/Ticketing.Infrastructure/            EF Core (Persistence/Configurations, Persistence/Migrations), auth stores, services
src/Ticketing.Api/Endpoints/             <Feature>Endpoints.cs (IEndpointModule, discovered automatically)
src/Ticketing.Api/Mcp/                   <Feature>Tools.cs ([McpServerToolType], discovered automatically)
tests/Ticketing.IntegrationTests/Infrastructure/   TicketingApiFactory, PostgresServer, Collections, TestApi helpers
```

## Adding a use case

`Projects` is the reference slice. Adding a feature touches no shared file: handlers, endpoint modules, MCP tool classes and test collections are all discovered by scanning. Copy the slice's shape:

- `Application/Projects/CreateProject.cs`: a write with validation, idempotency and activity.
- `GetProject.cs`: a read.
- `ListProjects.cs`: a paged list.
- `UpdateProject.cs`: a PATCH with `If-Match`.
- `Api/Endpoints/ProjectEndpoints.cs` and `Api/Mcp/ProjectTools.cs`: the transports.
- `tests/Ticketing.IntegrationTests/Projects/*`: the tests.

### 1. The use case: `Application/<Feature>/<UseCase>.cs`

```csharp
public static class StartRegression
{
    public sealed record Command(string ProjectKeyOrId, string? Name, string? Version) : IValidatable
    {
        public void Validate(Validator v) => v.MaxLength("name", Name, RegressionSession.NameMaxLength);
    }

    public sealed class Handler(ITicketingDbContext db, IProjectAccess access, ...) : IHandler<Command, SessionDto>
    {
        public async Task<SessionDto> HandleAsync(Command command, CancellationToken ct) { ... }
    }
}
```

Rules:

1. **Validate the input shape first:** `command.EnsureValid()`. The `Validator` collects every field error into one 400 `validation` response. Field names are the camelCase names clients send. The entities still enforce their own invariants and throw `DomainException` with a specific code.
2. **Check access next.**
   - Project-scoped: `access.EnsureCanReadAsync`, `EnsureCanWriteAsync` or `EnsureOwnerAsync`. These give 404 for unreadable projects (never 403), 403 for insufficient role or a read-only PAT, and 409 `project.archived`.
   - The string overloads are the single resolver for user input and accept a project key or an id. Every project route and tool takes `projectKeyOrId`; tickets will follow the same rule.
   - Not project-scoped: `currentUser.EnsureWriteScope()` for writes, `EnsureAdmin()` and `EnsureCookieSession()` (PAT, password, user and flag management, spec 5.5).
3. **Never leak private projects.** Compose every query that touches project data with `access.ReadableProjects()`, for example `db.Tickets.Where(t => access.ReadableProjects().Any(p => p.Id == t.ProjectId))`. This applies to search, boards, links, hints, dashboards and MCP. `tests/Ticketing.IntegrationTests/Projects/ReadableProjectsLeakGuardTests.cs` is the template: copy it for every new query and check admin, member, outsider and deleted-project results.
4. **Put behaviour on the entities.** For example `ticket.ChangeStatus(...)`, `TicketHierarchy`, `TicketLabels`, `RegressionSession.Start(...)` and `project.AddMember(...)`. Handlers load data, call domain methods and save. Handlers make no business decisions that the domain can make.
5. **Record activity and save once.**
   - Use `activity.Record(...)` / `activity.RecordChange(...)` for each changed field. Use action codes such as `ticket.created` and `ticket.field.changed`.
   - Then call one `db.SaveChangesAsync`.
   - `IClock.Now` is fixed for the request, so the entity and its activity entries share one timestamp.
   - Collaboration side effects (watchers now, notifications later) are derived from these entries inside the save by `IActivityObserver`s (`Collaboration/CollaborationProjector`, D-93). Don't call them from handlers; record the activity and add a rule there. Activity is saved with `SaveChangesAsync` only.
6. **Use the shared helpers for numbering, ranking and retries.**
   - Numbered entities (tickets, test cases, sessions, docs): call `IProjectCounters.NextAsync(projectId, CounterKind.X)` inside `db.InTransactionAsync(...)`, together with the insert.
   - Placement: every user-driven placement change (backlog reorder, backlog to board and back, board to board, column change) goes through `MoveTickets.Handler` (`POST /tickets/move`, MCP `move_ticket`, D-77). Don't add another endpoint that ranks or moves tickets; extend `MoveTickets.Command` instead. Board-level relocations (archive carry-over, unlink, delete, project archive) use `BoardRelocation`.
   - Ranks: use `ITicketRanker` (`BottomAsync`, `TopAsync`, `BetweenAsync`, and `PlaceManyAsync` for a block of tickets at a `RankAnchor`: top, bottom, before or after a ticket) inside the same transaction; it throws without one. Docs use the same ranker with `RankContainer.DocFolder(projectId, parentId)`; their tree changes go through `DocTree.LockAsync` first (D-109).
   - Tickets: resolve user input with `TicketLookup.ReadAsync/WriteAsync/OwnerAsync` (key or id; 404 for unreadable, `ticket.deleted` for deleted). Features that create tickets (bugs from regressions) inject `CreateTicket.Handler` and call `HandleAsync`, or `CreateAsync` inside their own transaction; `Placement = BacklogPlacement.Top` puts the ticket at the backlog top.
     - Each call takes a per-container advisory lock held until commit, so parallel placements get distinct ranks.
     - Pass the tickets being moved as `movingTicketIds`. They are excluded from neighbour lookup and from rebalancing.
     - When a key gets too long, or the neighbours are equal or out of order, the ranker rebalances the container itself. Don't keep other tickets of that container tracked: the rebalance rewrites them in SQL.
   - Creates: wrap the work in `idempotency.ExecuteAsync(command.IdempotencyKey, "<feature>.create", command with { IdempotencyKey = null }, ...)`. Mark `IdempotencyKey` with `[property: JsonIgnore]`.
     - Requests with the same user and key are serialized: the first one runs, and the others replay its result.
     - Map your unique indexes to feature codes, as `ProjectUniqueness.SaveAsync` does. The friendly pre-check alone is not race-proof.
7. **PATCH:**
   - Write the command as a record with init-only `Optional<T>` properties. Omitted means unchanged; `null` clears.
   - Mark transport-only properties (route key or id, `ExpectedVersion`) with `[JsonIgnore]`.
   - Call `db.ExpectVersion(entity, command.ExpectedVersion)` before changing the entity. A stale version gives 409 `concurrency.conflict` without the current state, and so does a concurrent writer.
   - `If-Match` is optional (D-43).
8. **Reads:** use `AsNoTracking()` and project straight into DTOs. Expose the entity's `RowVersion` as `RowVersion` (JSON `rowVersion`), never as `version`, because tickets have a business `version` field.
9. **Lists:**
   - Use keyset pagination: decode the cursor with `Cursor.Decode<TKey>(page.Cursor)`, filter `> key`, order by the key, and finish with `.ToCursorPageAsync(page, r => r.Key, ct)`.
   - The result is always `CursorPage<T>`, which serializes as `{ items, nextCursor }`.

Handlers are registered automatically (assembly scan of `IHandler<,>`), so there is nothing to add to DI.

### 2. The REST endpoint: `Api/Endpoints/<Feature>Endpoints.cs`

Add a `public sealed class <Feature>Endpoints : IEndpointModule` whose `MapEndpoints(RouteGroupBuilder api)` maps the routes. It is discovered automatically. Endpoints only translate:

- Route values and query strings go into the command.
- `request.ExpectedRowVersion()` reads `If-Match`.
- `request.IdempotencyKeyHeader()` reads `Idempotency-Key`.
- `response.SetRowVersion(dto.RowVersion)` sets the `ETag`.
- Return `TypedResults.Ok/Created/NoContent`.

Do not catch exceptions. The exception handler turns them into problem details. XSRF (cookie writes) and the read-only PAT guard already apply to the whole `/api/v1` group. Add `.RequireCookieSession()` for web-only endpoints.

### 3. The MCP tool: `Api/Mcp/<Feature>Tools.cs`

A `[McpServerToolType]` class with static methods. Inject the same handler as a parameter. Declare the arguments with `[Description]`s, and list allowed enum values in the description (spec 9.2).

- Read tools: `[McpServerTool(Name = "get_x", ReadOnly = true)]`.
- Write tools: add `[Authorize(Policy = AuthPolicies.CanWrite)]` so read-only tokens don't see them.
- Destructive tools set `Destructive = true`.

Tools throw like handlers. A filter turns `AppException` and `DomainException` into `isError: true` results with `{ code, message, hint }`. The write channel (`Mcp`) is derived automatically.

### 4. Tests

Domain rules go in `tests/Ticketing.Domain.Tests`. Use cases are tested end to end in `tests/Ticketing.IntegrationTests`.

Each feature declares its own collection next to its tests, for example `[CollectionDefinition(nameof(TicketsCollection))] public sealed class TicketsCollection : ICollectionFixture<TicketingApiFactory>;`. Its test classes use `[Collection(nameof(TicketsCollection))]`.

Every collection gets its own API host and its own database, cloned from a migrated template on one shared PostgreSQL container. Collections therefore run in parallel. The `TestApi` helpers:

| Helper | Gives you |
| --- | --- |
| `api.CreateUserAsync(role)` | A user with a known password (`TestUser`) |
| `api.LoginAsync(user, sendXsrfHeader: true)` | An `HttpClient` that behaves like the SPA: cookies, plus the XSRF header echoed on writes |
| `api.CreatePatClientAsync(user, scope)` / `CreatePatAsync` | A bearer-token client / the raw token |
| `api.CreateMcpClientAsync(token)` | An MCP client over Streamable HTTP |
| `api.ExecuteAsAsync(user, sp => ..., patScope)` | Runs application services as a user without HTTP |
| `api.WithDbAsync(db => ...)` | Arrange or assert directly against the database |
| `response.ReadAsync<T>(status)`, `response.ShouldBeProblemAsync(status, code)` | Assertions |

The collection's database is reset (Respawn) before every test, so each test arranges its own data. Tests inside one collection run sequentially.

For configuration-dependent tests (for example rate limits), derive a host on the same database with `api.WithWebHostBuilder(b => b.UseSetting(...))`. `AbuseProtectionTests` shows how.

Run `dotnet test` without the `rtk` prefix: rtk filters the test runner output and reports zero tests.

Performance tests carry `[Trait("Category", "Performance")]`. `DashboardPerformanceTests` seeds two 50 000-ticket projects with `INSERT ... SELECT`, asserts the dashboard's p95 stays under 500 ms and writes timings, per-statement durations and `EXPLAIN ANALYZE` plans to `dashboard-performance.txt` next to the test binaries. Skip them in a quick loop with `dotnet test -- --filter-not-trait "Category=Performance"`.

## Designing an achievement

Every new epic and feature is checked for achievements while it is planned (slice playbook, definition of done). The outcome is either a catalogue entry with its criterion, a linked ticket for one, or a line in the ticket saying none fits. "None fits" is a fine answer; most features don't need one.

**What makes a good one.** An achievement rewards a real action a person chose to take and nudges them towards a feature they may not have tried: filing a bug from a failed regression item (`found-it`), creating a board (`board-builder`), delegating a ticket to an agent (`delegator`). Good candidates are the first use of a new feature and the actions that make the tracker better for everyone (linking, testing, triage). Bad candidates are actions people take anyway with no choice in them (opening a page, signing in) and anything that only rewards volume.

**Hard rules** (D-144, spec 15.1). An idea that breaks one of these is dropped, not adapted:

- Nothing time-based: no streaks, no "within a day", no night-owl or weekend achievements.
- No points, currency or totals across achievements.
- No ranking, leaderboard or comparison between people, not even per team. An achievement says what you did, never how you did against others.
- No project or ticket id is stored with an earned tier, and the name and description never need one.
- Only activity at or after the user's start S counts; there is no backfill.
- Monotonic: an earned tier is never revoked, even when the counted entities are deleted later.
- Every channel counts (web, REST with a PAT, MCP), unless the achievement is about the channel itself (`machine-whisperer`).

**Tiers.** Thresholds follow how often the action naturally happens, so the first tier is reachable in normal work and the last one is rare:

- Once-only (`[1]`) for a feature you only need to discover: `board-builder`, `spring-cleaning`, `machine-whisperer`.
- `1 / 10` for occasional actions: `show-me`, `found-it`.
- `1 / 10 / 50` for regular actions: `bug-hunter`, `connector`, `delegator`, `test-author`.
- `1 / 10 / 50 / 250` for everyday work: `reporter`, `closer`, `ready-for-review`; `1 / 25 / 100 / 500` for the most frequent (`conversationalist`).
- Start above 1 when a single action means nothing: `triage` starts at 10, `regression-runner` at 10.

**Secret.** Make it secret only when it is a pleasant surprise rather than a goal, and announcing it would invite gaming or the wrong behaviour: undoing your own delete (`second-thoughts`), closing a ticket that blocks three open ones (`unblocker`), a ticket you worked on passing through every status (`grand-tour`). A secret entry has no "how to earn" hint and stays masked until earned. Achievements meant to nudge towards a feature are never secret, because the hint is the nudge.

**Criteria stay set-based.** A criterion counts for a whole batch of users, each with their own S, in a fixed number of queries: one `SELECT ... GROUP BY s.user_id` over `subjects`, or a computed criterion that runs a fixed number of queries per batch. Never a query per user or per entity. If the count needs data that is not recorded, add it additively to the activity payload or a table column first (as D-145 did for `assigneeId`). Declare in `Triggers` the activity actions that can raise the count (`board.created` for `board-builder`, the comment actions for `conversationalist`) so the projector can skip it; use `null` only when any action can (`machine-whisperer`). A criterion that needs state at a point in time, or someone else's action, needs a decision (`D-xx`) before it is built.

## Adding an achievement

Achievements (spec 15, D-144, D-145) are a catalogue in code plus one criterion per entry. Adding one touches no evaluator, projector, API or UI code:

1. **Catalogue entry** in `Domain/Achievements/AchievementCatalog.cs`: add an id constant and an `AchievementDefinition` to `All`.
   - The id is lower-case kebab case, at most 50 characters. It is stored with every earned tier, so it is never renamed or reused.
   - Give a name, a description, a "how to earn" hint (non-secret only; a secret entry passes `null` and `secret: true`), a Tabler icon name in kebab case (`file-plus`) and ascending thresholds (`[1]` for once-only). Register the icon in `MEDAL_GLYPHS` (`web/src/app/shared/ui/achievement-medal/medal-glyphs.ts`), or the medal draws the award glyph (D-151).
2. **Criterion** in `Application/Achievements/Criteria/`: an `internal sealed class` deriving from one of these. It is discovered by scanning.
   - `SqlAchievementCriterion`: `Sql` is one `SELECT s.user_id, <count>::int AS count FROM subjects s ... GROUP BY s.user_id` over the CTE `subjects(user_id, started_at)`. The evaluator runs all SQL criteria of a batch in one `UNION ALL` query. Inline constants (action codes, enum values) but never user input.
   - `ComputedAchievementCriterion`, when the count needs C# (for example parsing mentions): `CountAsync(db, subjects, ct)` is called once per batch and must use a fixed number of queries, never one per user. `CriterionSql.OverSubjects<T>` runs its SQL over the same `subjects` CTE (see `ShoutOutCriterion`).
   - Set `AchievementId` to the catalogue id, and `Triggers` to the activity actions that can raise the count (`null` when any action can).
3. **Follow the shared rules** with the `CriterionSql` helpers (`ActorEntries`, `StatusChangesTo`, `AliveTicket`, `AliveProject`, `TicketOrDoc`):
   - Count only rows at or after `s.started_at`.
   - Count distinct entities, of the subject only.
   - Count only alive entities unless the definition says otherwise.
   - New activity payload fields are additive. Old entries simply lack them, which no-backfill makes harmless.
4. **Tests** in `tests/Ticketing.IntegrationTests/Achievements/`, through REST and MCP (`AchievementTestData`): counting after S only, distinct or first time per entity, deleted entities, channel independence, and no other user's data. `AchievementEvaluatorTests` fails while an entry has no criterion or a criterion has no entry.
5. **Docs**: a row in spec 15.2 and 15.4, and a `D-xx` when the definition needed a choice.

## Error codes

Every error response is RFC 9457 problem details with a stable `code`. MCP returns the same code. Codes look like `<area>.<subject>[.<problem>]` in camelCase, for example `ticket.parent.cycle`, `project.key.taken` or `auth.invalidCredentials`. Feature codes are constants in `Domain/<Feature>/<Feature>Errors.cs`. Cross-cutting codes are in `Application/Common/AppErrors`.

| Source | Status | Code |
| --- | --- | --- |
| `Validator` (input shape) | 400 | `validation`, with `errors` per field |
| `DomainException` validation kind | 400 | specific (`ticket.labels.invalid`), `errors` when the field is known |
| Missing or invalid XSRF token | 400 | `xsrf.invalid` |
| Not signed in, or a bad, expired or revoked PAT | 401 | `auth.unauthenticated` (PAT failures also send `WWW-Authenticate: Bearer`) |
| Wrong email or password, unknown or locked account, on login | 401 | `auth.invalidCredentials` |
| Role or credentials insufficient | 403 | `project.forbidden`, `pat.readOnlyScope`, `auth.cookieSessionRequired`, ... |
| Not found or not readable | 404 | `project.notFound`, `ticket.notFound`, ... |
| Business rule, archived, duplicate, stale version | 409 | specific, `conflict.duplicate`, `concurrency.conflict` |
| PAT or login rate limit | 429 | `rateLimited`, with `Retry-After` |

A `hint` (how to fix the problem) is included when the domain provides one. MCP clients rely on it.

## Persistence

- One `IEntityTypeConfiguration` per entity in `Infrastructure/Persistence/Configurations`. Tables and columns are snake_case. `RowVersion` maps to `xmin`. Ids are UUIDv7 created in the domain (`EntityId.New()`).
- **Enums are stored as integers with explicit values.** Never renumber or reuse a value. Add new members with new numbers. Enum order in the database follows display order, so `ORDER BY priority` and `ORDER BY status` sort correctly.
- Ticket full text uses a stored generated column, shadow property `TicketSearch.VectorProperty`, with `english` weights title A and description B. Use `EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, text))`. Partial words use the trigram index on `title` (`EF.Functions.ILike`).
- Ranks are `COLLATE "C"`. Compare them in .NET with `string.CompareOrdinal`.

### Migration policy (v1 released 2026-10-27, tag `v1.0.0`)

`InitialCreate` is **frozen**: real databases (the team's own Ticketing instance) have applied it. Every schema change is a new migration with a descriptive name, never an edit of a merged one (ADR 0006):

```bash
dotnet ef migrations add AddTicketWatchers --project src/Ticketing.Infrastructure --startup-project src/Ticketing.Infrastructure --output-dir Persistence/Migrations
```

- Keep migrations additive. Renames, drops and tighter constraints use expand and contract across two releases.
- A migration that rewrites data gets an integration test against seeded data.
- Two branches adding migrations conflict in `TicketingDbContextModelSnapshot.cs`. The second branch to merge deletes its own migration files, merges `main`, and re-adds its migration on top. Never hand-merge the snapshot.
- Check for drift before pushing: `dotnet ef migrations has-pending-model-changes --project src/Ticketing.Infrastructure --startup-project src/Ticketing.Infrastructure`.

Migrations run automatically at API startup (EF Core takes a migration lock, so several instances are safe).

## Authentication in short

- **Cookie session `tkt_session`** for the SPA: HttpOnly, SameSite=Lax, 12 hour sliding expiry. It names a `user_sessions` row; the row and the user are re-read on every request, so sign-out (which deletes the row), deactivation, role changes and renames apply immediately (D-75).
- **XSRF:** `GET /api/v1/auth/csrf` issues `XSRF-TOKEN`. Cookie-authenticated unsafe requests must echo it in `X-XSRF-TOKEN`. PAT requests are exempt.
- **PAT:** `Authorization: Bearer tkt_<40 base62>`, stored as a SHA-256 hash, with last use recorded at most every 5 minutes.
  - Read-only tokens get 403 on writes.
  - Each token is limited to 600 requests per minute.
  - `/mcp` accepts PATs only; a cookie gets 401.
- **Lockout:** the 5th failed login in a row from one client address locks the account for that address for 15 minutes (`login_throttles`, D-74). Locked, unknown and wrong-password attempts all answer `401 auth.invalidCredentials` after the same hashing work.
  - Attempts on one account are serialized by a row lock, so parallel guesses all count.
  - Login is also limited per client address (20 per minute).
  - The client address is the TCP peer, or the last `X-Forwarded-For` hop when the peer is in `ForwardedHeaders__KnownNetworks` (D-73).
- **Data Protection keys** (which sign cookies and antiforgery tokens) are stored in the `data_protection_keys` table, so sessions survive restarts and work across instances.
