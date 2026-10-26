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

Or run everything in containers: `docker compose up --build db api`. The API is then also on http://localhost:5080. `web` (nginx + SPA, port 8080) is built from `./web`.

`docker-compose.override.yml` holds development-only additions: it publishes the database port, and compose loads it automatically. On a server, start only the base file so the database stays private to the compose network:

```bash
docker compose -f docker-compose.yml up -d --build
```

| URL | What |
| --- | --- |
| `/api/v1/...` | REST API |
| `/api/v1/openapi.json` | OpenAPI document |
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
| `ASPNETCORE_FORWARDEDHEADERS_ENABLED` | `true` behind nginx/TLS so `https` and client IPs are seen correctly |

Logs are JSON on the console (`simple` in Development).

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
6. **Use the shared helpers for numbering, ranking and retries.**
   - Numbered entities (tickets, test cases, sessions): call `IProjectCounters.NextAsync(projectId, CounterKind.X)` inside `db.InTransactionAsync(...)`, together with the insert.
   - Ranks: use `ITicketRanker` (`BottomAsync`, `TopAsync`, `BetweenAsync`) inside the same transaction; it throws without one.
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

## Error codes

Every error response is RFC 9457 problem details with a stable `code`. MCP returns the same code. Codes look like `<area>.<subject>[.<problem>]` in camelCase, for example `ticket.parent.cycle`, `project.key.taken` or `auth.lockedOut`. Feature codes are constants in `Domain/<Feature>/<Feature>Errors.cs`. Cross-cutting codes are in `Application/Common/AppErrors`.

| Source | Status | Code |
| --- | --- | --- |
| `Validator` (input shape) | 400 | `validation`, with `errors` per field |
| `DomainException` validation kind | 400 | specific (`ticket.labels.invalid`), `errors` when the field is known |
| Missing or invalid XSRF token | 400 | `xsrf.invalid` |
| Not signed in, or a bad, expired or revoked PAT | 401 | `auth.unauthenticated` (PAT failures also send `WWW-Authenticate: Bearer`) |
| Wrong email or password on login | 401 | `auth.invalidCredentials` |
| Role or credentials insufficient | 403 | `project.forbidden`, `pat.readOnlyScope`, `auth.cookieSessionRequired`, ... |
| Not found or not readable | 404 | `project.notFound`, `ticket.notFound`, ... |
| Business rule, archived, duplicate, stale version | 409 | specific, `conflict.duplicate`, `concurrency.conflict` |
| Locked account | 423 | `auth.lockedOut` |
| PAT or login rate limit | 429 | `rateLimited`, with `Retry-After` |

A `hint` (how to fix the problem) is included when the domain provides one. MCP clients rely on it.

## Persistence

- One `IEntityTypeConfiguration` per entity in `Infrastructure/Persistence/Configurations`. Tables and columns are snake_case. `RowVersion` maps to `xmin`. Ids are UUIDv7 created in the domain (`EntityId.New()`).
- **Enums are stored as integers with explicit values.** Never renumber or reuse a value. Add new members with new numbers. Enum order in the database follows display order, so `ORDER BY priority` and `ORDER BY status` sort correctly.
- Ticket full text uses a stored generated column, shadow property `TicketSearch.VectorProperty`, with `english` weights title A and description B. Use `EF.Property<NpgsqlTsVector>(t, TicketSearch.VectorProperty).Matches(EF.Functions.WebSearchToTsQuery(TicketSearch.Configuration, text))`. Partial words use the trigram index on `title` (`EF.Functions.ILike`).
- Ranks are `COLLATE "C"`. Compare them in .NET with `string.CompareOrdinal`.

### Migration policy (until v1 ships)

There is a single `InitialCreate` migration covering the whole model. Until v1 is released it is **regenerated, not appended to**. Every model change replaces it:

```bash
rm -r src/Ticketing.Infrastructure/Persistence/Migrations
dotnet ef migrations add InitialCreate --project src/Ticketing.Infrastructure --startup-project src/Ticketing.Infrastructure --output-dir Persistence/Migrations
docker compose down -v   # existing dev databases must be recreated
```

After v1, migrations are additive and never edited once merged. Feature branches that touch the model should regenerate the migration as the last commit before merging, so conflicts are resolved by regenerating rather than by hand. Migrations run automatically at API startup (EF Core takes a migration lock, so several instances are safe).

## Authentication in short

- **Cookie session `tkt_session`** for the SPA: HttpOnly, SameSite=Lax, 12 hour sliding expiry. The user is re-read on every request, so deactivation, role changes and renames apply immediately.
- **XSRF:** `GET /api/v1/auth/csrf` issues `XSRF-TOKEN`. Cookie-authenticated unsafe requests must echo it in `X-XSRF-TOKEN`. PAT requests are exempt.
- **PAT:** `Authorization: Bearer tkt_<40 base62>`, stored as a SHA-256 hash, with last use recorded at most every 5 minutes.
  - Read-only tokens get 403 on writes.
  - Each token is limited to 600 requests per minute.
  - `/mcp` accepts PATs only; a cookie gets 401.
- **Lockout:** the 5th failed login locks the account for 15 minutes, and the locking attempt already answers 423.
  - Attempts on one account are serialized by a row lock, so parallel guesses all count.
  - Login is also limited per client IP (20 per minute).
- **Data Protection keys** (which sign cookies and antiforgery tokens) are stored in the `data_protection_keys` table, so sessions survive restarts and work across instances.
