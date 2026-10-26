# Tech stack reference (verified 2026-10-26)

Reference for implementing engineers. Every version below was checked on 2026-10-26 against the npm registry, NuGet (`api.nuget.org` flat container), MCR/Docker Hub tag lists, or official docs. The backend snippets marked **[verified]** were compiled and run in a scratch project on .NET SDK 10.0.301 against Postgres 18 on Rancher Desktop: curl tests for auth, XSRF and MCP, plus an xUnit v3 + Testcontainers run.

## 0. Red flags (read first)

| # | Issue | Impact | Recommendation |
|---|---|---|---|
| R1 | **PrimeNG 22 is no longer open source.** `primeng@22.x`, `@primeuix/themes@3.x`, `@primeuix/styles@3.x`, `primeicons@8.x` and `@primeicons/angular` ship under the commercial "PrimeUI License" (see `LICENSE.md` in the `primeng@22.1.4` npm tarball). The free Community tier is for orgs with < $1M revenue, < 5 developers and < 10 employees, so Adamed does not qualify. A license key is required (`providePrimeNG({ license })`), and without one the app shows a "license cannot be verified" banner. PrimeNG 21.1.x is still MIT, but its peer dependency is `@angular/core ^21` (Angular 21 LTS ends 2027-06), so it is a dead end for a new app. | The original plan (Angular latest + PrimeNG) would need paid PrimeUI seats. | **Decided (owner, 2026-10-26): no PrimeNG.** Use **Angular Material 22 + CDK (MIT)**, Chart.js (MIT) for charts, and Tabler icons via ng-icons (MIT). See section 7. Note for AdaCon/AdaConExt (Angular 21 + PrimeNG 21): they hit the same wall when they upgrade to Angular 22. |
| R2 | Angular 22 needs **Node `^22.22.3 \|\| ^24.15.0 \|\| >=26`**. The local machine has Node 22.21.1, and `ng new` refuses to run on it (verified). | Blocks frontend scaffolding. | **Decided:** Node 24 LTS installed system-wide (winget). Target **24.22.1** (EOL 2028-04-30). Add `"engines": { "node": "^24.15.0" }` and an `.nvmrc`/`.node-version` with `24`. |
| R3 | Angular 22 requires **TypeScript `>=6.0 <6.1`**. `npm i typescript@latest` installs 7.0.2, which breaks the build. | Build break. | Keep the CLI-generated `typescript: ~6.0.2`. Don't let Renovate/Dependabot bump it past 6.0. |
| R4 | The local .NET SDK 10.0.301 is behind. The latest is **SDK 10.0.403 / runtime 10.0.14** (security release, 2026-10-25). | Security patches. | Install SDK 10.0.403. Use `global.json` with `rollForward: latestFeature`. |
| R5 | xunit.v3 4.x uses Microsoft Testing Platform v2. On the .NET 10 SDK, `dotnet test` **fails** with "Testing with VSTest target is no longer supported" unless `global.json` opts in to MTP (verified). | CI break. | Add `"test": { "runner": "Microsoft.Testing.Platform" }` to `global.json` (see section 5). |
| R6 | Minimal APIs **do not** validate antiforgery for JSON endpoints. `UseAntiforgery()` only checks form-bound endpoints. | CSRF hole if you rely on defaults. | Add an explicit endpoint filter on `/api` for cookie-authenticated unsafe methods (section 3, verified). |
| R7 | Postgres 18 Docker image changed `PGDATA` to `/var/lib/postgresql/18/docker` and the volume path to **`/var/lib/postgresql`**. | Data silently not persisted if you mount `/var/lib/postgresql/data`. | Mount the volume at `/var/lib/postgresql` (section 9). |
| R8 | MCP spec revision 2026-07-28 removed sessions (`Mcp-Session-Id`, the `initialize` handshake). The C# SDK 2.x defaults to **stateless**. | Server-to-client features (sampling, elicitation, roots) are unavailable in stateless mode. | Use stateless mode (the default). The tools we need are request/response only. |
| R9 | Npgsql EF 10.0.3 pulls EF Core **10.0.4** transitively. The latest patch is 10.0.14. | Missing patches. | Use Central Package Management and pin `Microsoft.EntityFrameworkCore.Relational` / `.Design` to 10.0.14. |

No other architectural problems found. Cookie + PAT behind a policy scheme, in-process MCP at `/mcp`, DB-backed FeatureManagement, OpenAPI + Scalar, WebApplicationFactory + Testcontainers, CDK drag-drop and nginx same-origin all work as planned. Each is validated below.

The whole frontend dependency set is MIT/ISC/Apache-2.0 (permissive). Run a license check (`npx license-checker-rseidelsohn --onlyAllow "MIT;ISC;Apache-2.0;BSD-2-Clause;BSD-3-Clause;0BSD;CC0-1.0;MPL-2.0 OR Apache-2.0;BlueOak-1.0.0;Python-2.0"`) in CI so a commercial relicense like PrimeNG's is caught on upgrade.

---

## 1. Versions at a glance

### Backend (.NET 10 LTS, EOL 2028-11-14)

| Package | Version | Notes |
|---|---|---|
| .NET SDK / runtime | **10.0.403 / 10.0.14** | .NET 11 is RC3 (STS). Stay on 10 LTS. |
| `ModelContextProtocol.AspNetCore` | **2.3.0** | Pulls `ModelContextProtocol` and `.Core` 2.3.0 and `Microsoft.Extensions.AI.Abstractions` 10.11.0 |
| `Microsoft.FeatureManagement.AspNetCore` | **4.8.0** | |
| `Npgsql.EntityFrameworkCore.PostgreSQL` | **10.0.3** | Npgsql 10.0.3. Trigram functions are built in (the old `.Trigrams` plugin package is dead at 5.0.10). |
| `Microsoft.EntityFrameworkCore.Design` / `.Relational` | **10.0.14** | Pin explicitly (R9) |
| `dotnet-ef` (local tool) | **10.0.14** | |
| `Microsoft.AspNetCore.OpenApi` | **10.0.14** | OpenAPI 3.1 by default |
| `Scalar.AspNetCore` | **2.18.3** | |
| `PasswordHasher<T>` | in shared framework | `Microsoft.Extensions.Identity.Core` ships with `Microsoft.AspNetCore.App`, so **no package reference needed** (verified) |
| `xunit.v3` | **4.0.2** | = `xunit.v3.mtp-v2`. No `xunit.runner.visualstudio` / `Microsoft.NET.Test.Sdk` needed with MTP. |
| `Microsoft.AspNetCore.Mvc.Testing` | **10.0.14** | |
| `Testcontainers.PostgreSql` | **4.16.0** | |
| `Respawn` | **7.0.0** | |

### Frontend

| Package | Version | Notes |
|---|---|---|
| `@angular/core` / `@angular/cli` | **22.2.3 / 22.2.4** | Released 2026-06-03, active until 2027-06, LTS until 2028-06 |
| `@angular/material` | **22.2.4** | MIT. Peers: `@angular/cdk` 22.2.4 (exact), Angular ^22. UI component library. |
| `@angular/cdk` | **22.2.4** | MIT. Drag-drop, overlay, virtual scroll, a11y. Keep it in lockstep with Material. |
| `@angular/material-date-fns-adapter` + `date-fns` | **22.2.4 + 4.4.0** | MIT. Date adapter for datepicker (no moment). |
| `@ng-icons/core` + `@ng-icons/tabler-icons` | **36.1.0 + 36.1.0** | MIT. Tabler icon set (MIT, ~5k SVG icons, tree-shaken per icon). |
| `typescript` | **~6.0.2** (6.0.3 latest) | Not 7.x (R3) |
| `chart.js` + `ng2-charts` | **4.6.1 + 11.0.0** | Both MIT. ng2-charts peers: chart.js ^4, Angular/CDK >=22. |
| `marked` + `dompurify` | **18.1.2 + 3.4.17** | `dompurify` ships its own types. Don't add `@types/dompurify`. |
| `vitest` / `jsdom` | ^5.0.0 / ^30.0.0 | CLI default test runner |
| `@playwright/test` | **1.64.1** | Docker image `mcr.microsoft.com/playwright:v1.64.1-noble` |

### Containers

| Image | Tag |
|---|---|
| .NET build | `mcr.microsoft.com/dotnet/sdk:10.0` (pin `10.0.403-noble` for reproducibility) |
| .NET runtime | `mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra` (pin `10.0.14-noble-chiseled-extra`) |
| Node build | `node:24.22.1-alpine` (or `node:24-alpine`) |
| nginx | `nginxinc/nginx-unprivileged:1.30-alpine` (stable branch, non-root, listens on 8080) |
| Postgres | `postgres:18.6-alpine` (or `postgres:18-alpine`) |

Suggested `global.json`:

```json
{
  "sdk": { "version": "10.0.100", "rollForward": "latestFeature" },
  "test": { "runner": "Microsoft.Testing.Platform" }
}
```

Use Central Package Management (`Directory.Packages.props` with `ManagePackageVersionsCentrally` + `CentralPackageTransitivePinningEnabled`) so the EF patch pin applies to the transitive references too.

---

## 2. MCP server (ModelContextProtocol.AspNetCore 2.3.0) [verified]

Facts from the 2.3.0 XML docs and the test run:

- `WithHttpTransport(o => ...)`: `HttpServerTransportOptions.SessionMode` defaults to `Stateless`. `Stateless = true` is a proxy for it. The other modes are `Stateful` (legacy clients only; refuses 2026-07-28 clients with -32022) and `StatefulForInitializeClients` (hybrid).
- **Use stateless.** It needs no session affinity and is safe behind nginx with multiple API instances. Every tool call runs inside the originating HTTP request, so `IHttpContextAccessor`, scoped `DbContext` and `HttpContext.User` all work. Old `initialize`-handshake clients still work in stateless mode (verified with protocol `2025-11-25`).
- Tool parameter binding: `CancellationToken`, `IServiceProvider`, `McpServer`, `IProgress<ProgressNotificationValue>`, **any DI-registered service**, and **`ClaimsPrincipal`** are bound by the SDK and kept out of the JSON schema (verified: `ClaimsPrincipal user` received the PAT principal). Everything else comes from the arguments. Constructor injection on the tool class works too (scoped per request).
- Throw `McpException` to return a message to the client. Other exceptions become a generic error.
- `AddAuthorizationFilters()` enables `[Authorize]` / `[Authorize(Roles = "...")]` / `[AllowAnonymous]` on individual tools, and also filters `tools/list`.
- 2.3.0 sends response headers only after the first protocol message. Long silent tools need progress notifications or a generous proxy read timeout (section 9).

```csharp
builder.Services
    .AddMcpServer()
    .WithHttpTransport(o => o.Stateless = true)
    .AddAuthorizationFilters()
    .WithToolsFromAssembly();

builder.Services.AddAuthorization(o =>
{
    o.FallbackPolicy = new AuthorizationPolicyBuilder().RequireAuthenticatedUser().Build();
    o.AddPolicy("Mcp", p => p.AddAuthenticationSchemes(AuthSchemes.Pat).RequireAuthenticatedUser());
});

app.MapMcp("/mcp").RequireAuthorization("Mcp");
```

The `Mcp` policy pins the endpoint to the PAT scheme. A browser session cookie gets **401** on `/mcp` (verified), so MCP is immune to CSRF and DNS-rebinding attacks that ride on cookies.

```csharp
public interface ICurrentUser { Guid Id { get; } string Name { get; } }

public sealed class HttpCurrentUser(IHttpContextAccessor accessor) : ICurrentUser
{
    private ClaimsPrincipal Principal =>
        accessor.HttpContext?.User ?? throw new InvalidOperationException("No HTTP context.");
    public Guid Id => Guid.Parse(Principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
    public string Name => Principal.Identity?.Name ?? "";
}

[McpServerToolType]
public sealed class TicketTools(AppDbContext db, ICurrentUser currentUser)
{
    [McpServerTool(Name = "whoami", ReadOnly = true), Description("Returns the user the token belongs to.")]
    public string WhoAmI() => $"{currentUser.Name} ({currentUser.Id})";

    [McpServerTool(Name = "get_ticket", ReadOnly = true), Description("Gets a ticket by its key, e.g. TKT-42.")]
    public async Task<TicketDto> GetTicket(
        [Description("Ticket key: <PROJECT>-<NUMBER>")] string key, CancellationToken ct)
    {
        // parse key, query db ...
        return dto ?? throw new McpException($"Ticket '{key}' not found.");
    }

    // Alternative to ICurrentUser: let the SDK bind the principal directly.
    [McpServerTool(Name = "my_tickets", ReadOnly = true)]
    public Task<IReadOnlyList<TicketDto>> MyTickets(ClaimsPrincipal user, CancellationToken ct) => ...;
}
```

Use the same `ICurrentUser` abstraction in the REST endpoints and the MCP tools, so tools call the same application services as the API. Annotate tools with `ReadOnly` / `Destructive` / `Idempotent`, which clients show to users. Return DTO records: they are serialized to JSON text content.

**Adding the server to Claude Code** (from the official docs at code.claude.com/docs/en/mcp):

```bash
claude mcp add --transport http ticketing https://ticketing.example.com/mcp \
  --header "Authorization: Bearer tkt_xxxxxxxxxxxxxxxx"
# --scope local (default) | project (.mcp.json) | user
```

Project-shared `.mcp.json` (keeps the token out of git):

```json
{ "mcpServers": { "ticketing": {
    "type": "http",
    "url": "${TICKETING_URL:-https://ticketing.example.com}/mcp",
    "headers": { "Authorization": "Bearer ${TICKETING_PAT}" } } } }
```

When an `Authorization` header is configured, a 401 is reported as a failed connection. It does not trigger OAuth discovery, so we don't need `/.well-known/oauth-protected-resource`. Return `WWW-Authenticate: Bearer` on 401, which the PAT handler below does.

---

## 3. Auth: cookie (SPA) + PAT (API/MCP) + XSRF [verified]

Design:
- **Policy scheme** `Smart` is the default. A request with `Authorization: Bearer ...` goes to the PAT scheme. Everything else goes to the cookie scheme.
- **Cookie**: `HttpOnly`, `SameSite=Strict` (the SPA is same-origin behind nginx), `Secure` in production. .NET 10 already returns 401/403 instead of redirects for JSON minimal-API endpoints (breaking change "Cookie login redirects disabled for known API endpoints"). Overriding the events, as below, makes this explicit for every endpoint.
- **PAT**: format `tkt_<43 base64url chars>` (32 random bytes). Store **SHA-256** of the token (unique index), not PBKDF2: the tokens are high-entropy and must be looked up by hash on every request. Show the token once. Keep `DisplayPrefix`, `ExpiresAt`, `RevokedAt` and `LastUsedAt` (write throttled to 5 minutes). The `tkt_` prefix makes leaked tokens greppable by secret scanners.
- **XSRF**: Angular `HttpClient` (Angular 22, fetch backend by default) reads cookie `XSRF-TOKEN` and sends header `X-XSRF-TOKEN`. It does so only for non-GET/HEAD requests to the **same origin** (verified in `@angular/common@22.2.3` source), with no configuration needed. Server side: `AddAntiforgery(o => o.HeaderName = "X-XSRF-TOKEN")`, issue the token into a JS-readable cookie, and validate it with an endpoint filter (R6). The check is skipped for PAT requests.
- Antiforgery tokens are **bound to the user identity**. Re-issue the token after login (set `HttpContext.User` first, as below) and after logout. The SPA calls `GET /api/auth/me` on bootstrap, which also issues the cookie.

```csharp
builder.Services
    .AddAuthentication(AuthSchemes.Smart)
    .AddPolicyScheme(AuthSchemes.Smart, AuthSchemes.Smart, o =>
    {
        o.ForwardDefaultSelector = ctx =>
            ctx.Request.Headers.Authorization.ToString().StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase)
                ? AuthSchemes.Pat
                : AuthSchemes.Cookie;
    })
    .AddCookie(AuthSchemes.Cookie, o =>
    {
        o.Cookie.Name = "tkt_session";
        o.Cookie.HttpOnly = true;
        o.Cookie.SameSite = SameSiteMode.Strict;
        o.Cookie.SecurePolicy = CookieSecurePolicy.SameAsRequest; // Always in prod (needs forwarded headers, section 9)
        o.SlidingExpiration = true;
        o.ExpireTimeSpan = TimeSpan.FromHours(12);
        o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = 401; return Task.CompletedTask; };
        o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = 403; return Task.CompletedTask; };
    })
    .AddScheme<AuthenticationSchemeOptions, PatAuthenticationHandler>(AuthSchemes.Pat, null);

builder.Services.AddAntiforgery(o => o.HeaderName = "X-XSRF-TOKEN");
builder.Services.AddSingleton<IPasswordHasher<User>, PasswordHasher<User>>();
```

PAT handler:

```csharp
public sealed class PatAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder,
    AppDbContext db, TimeProvider clock)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        string? header = Request.Headers.Authorization;
        if (header is null || !header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return AuthenticateResult.NoResult();
        var token = header["Bearer ".Length..].Trim();
        if (!token.StartsWith(PersonalAccessTokens.Prefix, StringComparison.Ordinal))
            return AuthenticateResult.NoResult();

        var hash = PersonalAccessTokens.Hash(token);              // SHA256.HashData(UTF8 bytes)
        var now = clock.GetUtcNow();
        var pat = await db.PersonalAccessTokens
            .Where(t => t.TokenHash == hash && t.RevokedAt == null && (t.ExpiresAt == null || t.ExpiresAt > now))
            .Select(t => new { t.Id, t.UserId, t.User.DisplayName, t.User.Roles, t.LastUsedAt })
            .SingleOrDefaultAsync(Context.RequestAborted);
        if (pat is null) return AuthenticateResult.Fail("Invalid or expired token.");

        if (pat.LastUsedAt is null || now - pat.LastUsedAt > TimeSpan.FromMinutes(5))
            await db.PersonalAccessTokens.Where(t => t.Id == pat.Id)
                .ExecuteUpdateAsync(s => s.SetProperty(t => t.LastUsedAt, now), Context.RequestAborted);

        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, pat.UserId.ToString()),
            new(ClaimTypes.Name, pat.DisplayName),
            new("pat_id", pat.Id.ToString()),
        };
        claims.AddRange(pat.Roles.Select(r => new Claim(ClaimTypes.Role, r)));
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
        return AuthenticateResult.Success(new AuthenticationTicket(principal, Scheme.Name));
    }

    protected override Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        Response.StatusCode = StatusCodes.Status401Unauthorized;
        Response.Headers.WWWAuthenticate = "Bearer";
        return Task.CompletedTask;
    }
}
```

Login + XSRF issuing + validation filter:

```csharp
var api = app.MapGroup("/api").AddEndpointFilter(XsrfFilter.Validate);

api.MapPost("/auth/login", async (LoginRequest req, AppDbContext db, IPasswordHasher<User> hasher,
                                  IAntiforgery af, HttpContext ctx) =>
{
    var user = await db.Users.SingleOrDefaultAsync(u => u.Email == req.Email);
    var result = user is null ? PasswordVerificationResult.Failed
                              : hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password);
    if (result == PasswordVerificationResult.Failed) return Results.Unauthorized();
    // if result == SuccessRehashNeeded -> user.PasswordHash = hasher.HashPassword(user, req.Password); save

    var claims = new List<Claim> { new(ClaimTypes.NameIdentifier, user!.Id.ToString()), new(ClaimTypes.Name, user.DisplayName) };
    claims.AddRange(user.Roles.Select(r => new Claim(ClaimTypes.Role, r)));
    var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, AuthSchemes.Cookie));
    await ctx.SignInAsync(AuthSchemes.Cookie, principal);

    ctx.User = principal;              // antiforgery token must be bound to the new identity
    XsrfFilter.IssueToken(ctx, af);
    return Results.NoContent();
}).AllowAnonymous();

public static class XsrfFilter
{
    public static void IssueToken(HttpContext ctx, IAntiforgery af)
    {
        var tokens = af.GetAndStoreTokens(ctx);
        ctx.Response.Cookies.Append("XSRF-TOKEN", tokens.RequestToken!,
            new CookieOptions { HttpOnly = false, SameSite = SameSiteMode.Strict, Secure = ctx.Request.IsHttps, Path = "/" });
    }

    public static async ValueTask<object?> Validate(EndpointFilterInvocationContext context, EndpointFilterDelegate next)
    {
        var http = context.HttpContext;
        var method = http.Request.Method;
        var unsafeMethod = !(HttpMethods.IsGet(method) || HttpMethods.IsHead(method) || HttpMethods.IsOptions(method));
        if (unsafeMethod && http.User.Identity?.AuthenticationType == AuthSchemes.Cookie)
        {
            var af = http.RequestServices.GetRequiredService<IAntiforgery>();
            if (!await af.IsRequestValidAsync(http))
                return Results.Problem(statusCode: 400, title: "Invalid or missing XSRF token.");
        }
        return await next(context);
    }
}
```

Verified behaviour: unauthenticated → 401. Cookie POST without header → 400. Cookie POST with `X-XSRF-TOKEN` → 200. PAT POST without XSRF → 200. Bad PAT → 401 + `WWW-Authenticate: Bearer`.

`PasswordHasher<TUser>` defaults to format V3 (PBKDF2-HMAC-SHA512, 100k iterations) and needs no Identity stores or `UserManager`. `TUser` can be any class.

Angular side: `provideHttpClient(withInterceptors([...]))`. XSRF is on by default. Call `/api/auth/me` in an app initializer.

---

## 4. EF Core 10 + Npgsql 10 [verified]

```csharp
protected override void OnModelCreating(ModelBuilder b)
{
    b.HasPostgresExtension("pg_trgm");
    b.Entity<Ticket>(t =>
    {
        t.HasIndex(x => new { x.ProjectId, x.Number }).IsUnique();
        t.Property(x => x.Rank).UseCollation("C");                       // byte-order compare for fractional keys
        t.HasIndex(x => new { x.ProjectId, x.Rank });
        t.HasIndex(x => x.Labels).HasMethod("gin");                      // List<string> -> text[]
        t.ComplexCollection(x => x.TestSteps, s => s.ToJson());          // List<TestStep> -> jsonb (EF 10 complex types)
        t.HasGeneratedTsVectorColumn(x => x.SearchVector, "simple", x => new { x.Title, x.Description })
            .HasIndex(x => x.SearchVector).HasMethod("gin");
        t.HasIndex(x => x.Title).HasMethod("gin").HasOperators("gin_trgm_ops");
    });
}
```

- **`text[]`**: `List<string>` maps to a native array by default. With a GIN index declared via `HasMethod("gin")`, `Labels.Contains("bug")` translates to `"Labels" @> ARRAY['bug']` (index-usable). Without it, EF 10 emits `= ANY(...)` (Npgsql 10 breaking change). "Has any of" is `t.Labels.Intersect(wanted).Any()`, which becomes `"Labels" && @wanted`. Label hints ("previous values in project") come from `SELECT DISTINCT unnest("Labels") ...`.
- **`jsonb`**: EF 10 **complex types + `ToJson()`** is the preferred mapping (it replaces owned-JSON). LINQ into the collection works (`TestSteps.Any(s => s.Action.Contains("x"))` translates to `jsonb_to_recordset`), and `ExecuteUpdate` can do partial `jsonb_set` updates. Raw JSON blobs (feature flag definitions) are `string` + `HasColumnType("jsonb")`.
- **Ticket numbers per project** (gap-free, concurrency-safe; verified with 30 parallel requests: 33 unique numbers, no errors). Keep a counter on the project row and increment it with `UPDATE ... RETURNING` in the same transaction as the insert. The row lock serializes creation per project, and a rollback also rolls back the counter. Use `ToListAsync()`, not `SingleAsync()`, because EF cannot compose over `UPDATE ... RETURNING`.

```csharp
public static async Task<int> NextAsync(AppDbContext db, Guid projectId, CancellationToken ct)
{
    var numbers = await db.Database.SqlQuery<int>($"""
        UPDATE "Projects" SET "NextTicketNumber" = "NextTicketNumber" + 1
        WHERE "Id" = {projectId}
        RETURNING "NextTicketNumber" - 1 AS "Value"
        """).ToListAsync(ct);
    return numbers.Single();
}

await using var tx = await db.Database.BeginTransactionAsync(ct);
var number = await TicketNumbering.NextAsync(db, projectId, ct);
// compute rank here too (after the lock) so concurrent appends don't collide
db.Tickets.Add(new Ticket { ProjectId = projectId, Number = number, ... });
await db.SaveChangesAsync(ct);
await tx.CommitAsync(ct);
```

  Keep the unique index `(ProjectId, Number)` as a backstop. If you enable `EnableRetryOnFailure`, wrap the transaction in `db.Database.CreateExecutionStrategy().ExecuteAsync(...)`. Don't use one Postgres `SEQUENCE` per project: it needs DDL per project and leaves gaps.
- **Search**:
  - Full text: a stored generated `tsvector` with a GIN index, queried as `t.SearchVector.Matches(EF.Functions.WebSearchToTsQuery("simple", q))`, ordered by `t.SearchVector.Rank(...)`. Use the `simple` config because content is English-only for now but codes and identifiers matter. Switch to `english` for stemming if wanted.
  - Fuzzy/typo-tolerant: `pg_trgm` GIN on `Title`, queried with `EF.Functions.TrigramsAreWordSimilar(q, t.Title)` (`<%`) and ordered by `TrigramsWordSimilarity`. Also good for `ILIKE '%x%'` (`EF.Functions.ILike`).
  - Ticket-key lookup (`TKT-42`) should be an exact match before either.
  - All of these translations were verified.
- **Other notes**: EF 10 generates UUIDv7 `Guid` keys client-side (observed). `timestamptz` + `DateTimeOffset` requires offset 0 (UTC). Run migrations at startup behind a config flag (`Database:MigrateOnStartup`, EF 9+ takes a migration lock), or as a compose one-shot using `dotnet ef migrations bundle`.
- **Tooling**: `dotnet new tool-manifest && dotnet tool install dotnet-ef --version 10.0.14`. Reference `Microsoft.EntityFrameworkCore.Design` 10.0.14 (`PrivateAssets=all`) in the startup project.

---

## 5. Integration tests: xUnit v3 + WebApplicationFactory + Testcontainers + Respawn [verified]

Run result: 4 tests, about 15 s including the container start, on Rancher Desktop 29.5.3 (dockerd/moby, `npipe:////./pipe/docker_engine`). **No `TESTCONTAINERS_*` env vars were needed, and Ryuk (`testcontainers/ryuk:0.14.0`) ran and cleaned up.**

Rancher Desktop notes:
- The container engine must be **dockerd (moby)**. containerd/nerdctl mode is not supported by Testcontainers.
- If Docker is not auto-detected, set `DOCKER_HOST=npipe:////./pipe/docker_engine`.
- Only if Ryuk is blocked (e.g. corporate policy): `TESTCONTAINERS_RYUK_DISABLED=true`, and accept leftover containers.

`.NET 10` makes the top-level `Program` usable from the test project without `public partial class Program {}` (verified).

```xml
<!-- Api.Tests.csproj -->
<PropertyGroup><TargetFramework>net10.0</TargetFramework><OutputType>Exe</OutputType></PropertyGroup>
<ItemGroup>
  <PackageReference Include="xunit.v3" Version="4.0.2" />
  <PackageReference Include="Microsoft.AspNetCore.Mvc.Testing" Version="10.0.14" />
  <PackageReference Include="Testcontainers.PostgreSql" Version="4.16.0" />
  <PackageReference Include="Respawn" Version="7.0.0" />
</ItemGroup>
```

```csharp
public sealed class ApiFixture : WebApplicationFactory<Program>, IAsyncLifetime, INotifyTestLifecycleAsync
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder("postgres:18-alpine").Build();
    private Respawner _respawner = null!;

    public async ValueTask InitializeAsync()
    {
        await _postgres.StartAsync();
        using (var scope = Services.CreateScope())                       // builds the host -> ConfigureWebHost runs
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();

        await using var conn = new NpgsqlConnection(_postgres.GetConnectionString());
        await conn.OpenAsync();
        _respawner = await Respawner.CreateAsync(conn, new RespawnerOptions
        {
            DbAdapter = DbAdapter.Postgres,
            SchemasToInclude = ["public"],
            TablesToIgnore = ["__EFMigrationsHistory"],
        });
    }

    // xUnit v3 4.0: fixtures can observe test lifecycle -> reset DB before every test
    public async ValueTask OnTestStartingAsync(IXunitTest test)
    {
        await using var conn = new NpgsqlConnection(_postgres.GetConnectionString());
        await conn.OpenAsync();
        await _respawner.ResetAsync(conn);
    }
    public ValueTask OnTestFinishedAsync(IXunitTest test) => ValueTask.CompletedTask;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Db", _postgres.GetConnectionString());
    }

    public override async ValueTask DisposeAsync()
    {
        await base.DisposeAsync();
        await _postgres.DisposeAsync();
    }
}

[CollectionDefinition(nameof(ApiCollection))]
public sealed class ApiCollection : ICollectionFixture<ApiFixture>;

[Collection(nameof(ApiCollection))]
public sealed class TicketTests(ApiFixture api) { /* api.CreateClient(), TestContext.Current.CancellationToken */ }
```

- Use `MigrateAsync()` in tests (the scratch project used `EnsureCreated`) so migrations are exercised.
- Seed reference data (statuses, users) after each reset, or add those tables to `TablesToIgnore`.
- For authenticated tests, seed a user + PAT and use `client.DefaultRequestHeaders.Authorization = new("Bearer", pat)`. This avoids XSRF handling in most tests, so keep a few cookie+XSRF tests explicitly.
- Tests sharing one collection run sequentially, which Respawn requires. For parallelism later, use multiple collections, each with its own database (Testcontainers can create one per fixture).
- `dotnet test` requires the `global.json` `test.runner` entry (R5).

---

## 6. Microsoft.FeatureManagement 4.8.0 (DB-backed) [verified]

Approach: store each flag as a row `(Name PK, Definition jsonb, ExposeToClient bool, UpdatedAt)`. `Definition` uses the **Microsoft feature-flag schema** (`enabled`, `conditions.client_filters`, `variants`, `allocation`, `telemetry`). The custom provider loads all rows, caches them for 30 s (plus explicit invalidation after an admin edit), and **delegates parsing to the library's own `ConfigurationFeatureDefinitionProvider`**. Targeting, variants and allocation therefore come for free, and the admin UI only has to produce schema-valid JSON.

```csharp
public sealed class DbFeatureDefinitionProvider(IServiceScopeFactory scopes, IMemoryCache cache) : IFeatureDefinitionProvider
{
    private const string CacheKey = "feature-definitions";

    public async Task<FeatureDefinition?> GetFeatureDefinitionAsync(string featureName) =>
        (await LoadAsync()).GetValueOrDefault(featureName);

    public async IAsyncEnumerable<FeatureDefinition> GetAllFeatureDefinitionsAsync()
    {
        foreach (var d in (await LoadAsync()).Values) yield return d;
    }

    public void Invalidate() => cache.Remove(CacheKey);

    private async Task<IReadOnlyDictionary<string, FeatureDefinition>> LoadAsync() =>
        (await cache.GetOrCreateAsync(CacheKey, async entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromSeconds(30);
            await using var scope = scopes.CreateAsyncScope();
            var rows = await scope.ServiceProvider.GetRequiredService<AppDbContext>().FeatureFlags.AsNoTracking().ToListAsync();
            return await ParseAsync(rows);
        }))!;

    private static async Task<IReadOnlyDictionary<string, FeatureDefinition>> ParseAsync(IEnumerable<FeatureFlag> rows)
    {
        var flags = new JsonArray();
        foreach (var row in rows)
        {
            var node = JsonNode.Parse(row.Definition)!.AsObject();
            node["id"] = row.Name;
            flags.Add(node);
        }
        var json = new JsonObject { ["feature_management"] = new JsonObject { ["feature_flags"] = flags } };
        var configuration = new ConfigurationBuilder()
            .AddJsonStream(new MemoryStream(Encoding.UTF8.GetBytes(json.ToJsonString()))).Build();

        using var parser = new ConfigurationFeatureDefinitionProvider(configuration);
        var result = new Dictionary<string, FeatureDefinition>(StringComparer.OrdinalIgnoreCase);
        await foreach (var d in parser.GetAllFeatureDefinitionsAsync()) result[d.Name] = d;
        return result;
    }
}

public sealed class UserTargetingContextAccessor(IHttpContextAccessor accessor) : ITargetingContextAccessor
{
    public ValueTask<TargetingContext> GetContextAsync()
    {
        var user = accessor.HttpContext?.User;
        return ValueTask.FromResult(new TargetingContext
        {
            UserId = user?.FindFirstValue(ClaimTypes.NameIdentifier),
            Groups = user?.FindAll(ClaimTypes.Role).Select(c => c.Value).ToList() ?? [],
        });
    }
}

// registration: register our provider BEFORE AddFeatureManagement (it uses TryAdd)
builder.Services.AddMemoryCache();
builder.Services.AddSingleton<DbFeatureDefinitionProvider>();
builder.Services.AddSingleton<IFeatureDefinitionProvider>(sp => sp.GetRequiredService<DbFeatureDefinitionProvider>());
builder.Services.AddFeatureManagement().WithTargeting<UserTargetingContextAccessor>();
```

Don't use the built-in `WithTargeting()` (no generic). Its `DefaultHttpTargetingContextAccessor` uses `Identity.Name` as the user id, and we want the stable user GUID.

Example definitions (verified: a user in role `beta` gets `NewBoard=true` and `BoardLayout=Compact`):

```json
{ "enabled": true,
  "conditions": { "client_filters": [ { "name": "Microsoft.Targeting",
    "parameters": { "Audience": {
      "Users": ["<user-guid>"],
      "Groups": [ { "Name": "beta", "RolloutPercentage": 100 } ],
      "DefaultRolloutPercentage": 10,
      "Exclusion": { "Users": [], "Groups": [] } } } } ] } }
```

```json
{ "enabled": true,
  "variants": [ { "name": "Compact" }, { "name": "Comfortable", "configuration_value": { "rowHeight": 48 } } ],
  "allocation": {
    "default_when_enabled": "Comfortable",
    "group": [ { "variant": "Compact", "groups": ["beta"] } ],
    "percentile": [ { "variant": "Compact", "from": 0, "to": 50 } ],
    "seed": "board-layout-2026" },
  "telemetry": { "enabled": true } }
```

Variants are the A/B mechanism. Percentile allocation is deterministic per `UserId` + seed, so a user stays in the same bucket. With `telemetry.enabled`, the library emits evaluation events (an `ActivitySource`) that can be exported later.

**Exposing to the SPA**: a single endpoint that evaluates only the flags marked `ExposeToClient`, so internal flag names don't leak. Use the scoped **snapshot** manager for consistent values within one request. In Angular, load it in an app initializer into a `signal<Record<string, {enabled, variant}>>`, and gate views with `@if (flags().NewBoard?.enabled)` or a structural directive/guard. Server-side, gate endpoints with `.WithFeatureGate("NewBoard")` (minimal APIs).

```csharp
api.MapGet("/features", async (IVariantFeatureManagerSnapshot features, AppDbContext db, CancellationToken ct) =>
{
    var exposed = await db.FeatureFlags.Where(f => f.ExposeToClient).Select(f => f.Name).ToListAsync(ct);
    var result = new Dictionary<string, object>();
    foreach (var name in exposed)
        result[name] = new { enabled = await features.IsEnabledAsync(name, ct),
                             variant = (await features.GetVariantAsync(name, ct))?.Name };
    return result;
});
```

With several API instances, a flag edit takes up to 30 s to reach other instances. Lower the TTL, or add Postgres `LISTEN/NOTIFY` invalidation if that ever matters.

---

## 7. Angular 22

**Scaffold** (after installing Node 24.22.1). Run from the repo root:

```bash
npx @angular/cli@22.2.4 new ticketing-web --directory web --style=scss --ssr=false --zoneless \
  --routing --test-runner=vitest --skip-git --package-manager=npm --ai-config=claude-code
```

Defaults verified in `@schematics/angular@22.2.4`:
- `standalone` and `zoneless` are **true** by default. A zoneless app has no `zone.js` and no `provideZoneChangeDetection`.
- `testRunner` defaults to **vitest** (karma is still selectable). Generated dev deps: `vitest ^5`, `jsdom ^30`.
- `strict` is true. The file-naming style is "2025" (`app.ts`, not `app.component.ts`).
- `--ai-config` accepts `claude-code`, `cursor`, `gemini-cli`, `open-ai-codex`, `vscode` and `none`.
- The generated `typescript` is `~6.0.2`.

**UI library: Angular Material 22.2.4 + CDK 22.2.4 (MIT).** This is the owner's decision after the PrimeNG relicensing (R1).

Rationale:
- Google-maintained and released in lockstep with Angular. Material declares peers on Angular `^22 || ^23` and an exact CDK version, so major upgrades are a single `ng update`.
- No license keys and no vendor relicensing risk.
- Zoneless and signal friendly.

```bash
cd web
npx ng add @angular/material@22.2.4 --theme=azure-blue   # options: azure-blue | rose-red | magenta-violet | cyan-orange
npm i @angular/material-date-fns-adapter@22.2.4 date-fns@4.4.0 @ng-icons/core@36.1.0 @ng-icons/tabler-icons@36.1.0
```

Material 22 has no `@angular/animations` dependency (its only runtime dependency is `tslib`).

**Theming (M3 tokens).** The public SCSS API in `@angular/material@22.2.4/_index.scss` includes:
- `mat.theme`, `mat.theme-overrides`
- `mat.system-level-*`
- the palettes `$azure-palette`, `$violet-palette`, etc.
- per-component `*-overrides` mixins (`mat.button-overrides`, `mat.card-overrides`, ...)

Map our design tokens (`docs/design/tokens.scss`) onto M3 system variables, not per-component CSS hacks:

```scss
@use '@angular/material' as mat;

html {
  color-scheme: light dark;                         // light-dark() driven; toggle via `color-scheme` on <html>
  @include mat.theme((
    color: (primary: mat.$azure-palette, tertiary: mat.$violet-palette),
    typography: (plain-family: 'Inter, system-ui, sans-serif', brand-family: 'Inter, system-ui, sans-serif'),
    density: -1,                                      // denser tables/forms for a tracker UI
  ));

  @include mat.theme-overrides((                      // project tokens -> M3 system tokens
    primary: var(--tkt-color-primary),
    surface: var(--tkt-color-surface),
    corner-medium: var(--tkt-radius-md),
  ));
}

.board-card { @include mat.card-overrides((outlined-container-shape: var(--tkt-radius-sm))); }
```

- Components read `--mat-sys-*` CSS variables, so custom components (kanban cards, ticket rows) should use `var(--mat-sys-surface-container)` etc. and stay consistent in dark mode.
- For a custom palette from a brand hex, generate one with `ng generate @angular/material:theme-color`.
- Note: anything in `docs/design/primeng-preset.md` must be re-expressed as M3 system-token overrides. The semantic token names map almost 1:1 (primary, surface, outline, radius, typography).

Component mapping for the expected screens. Material is leaner than PrimeNG, so plan for these small in-house components:

| Need | Use |
|---|---|
| Backlog / test-case tables | `mat-table` + `matSort` + `mat-paginator` (server-side). For long lists, a CDK `cdk-virtual-scroll-viewport` with a custom row layout. |
| Board (kanban) | CDK drag-drop + `mat-card` |
| Dialogs, side panel | `MatDialog`, `mat-sidenav` / `MatBottomSheet` |
| Labels / versions with hints | `mat-chip-grid` + `mat-autocomplete` (suggestions from `/api/projects/{id}/labels`) |
| Filters, selects, dates | `mat-select`, `mat-button-toggle`, `mat-datepicker` + `provideDateFnsAdapter()` |
| Toasts | `MatSnackBar` |
| Menus, tooltips, tabs, badges, progress | `mat-menu`, `matTooltip`, `mat-tab-group`, `matBadge`, `mat-progress-bar` |
| Markdown editor | `textarea` + preview via `MarkdownPipe` (below). No WYSIWYG dependency for now. |

**Icons: Tabler Icons via `@ng-icons` (both MIT).** SVG, tree-shaken per icon (only the icons passed to `provideIcons` are bundled), and stroke-width/size/color can be set with signal inputs. Material Symbols is not used because it is **Apache-2.0**, not MIT, and is a large icon font. `<mat-icon>` stays unused, or can wrap `ng-icon` content.

```ts
import { NgIcon, provideIcons } from '@ng-icons/core';
import { tablerBug, tablerLayoutKanban, tablerSearch, tablerChecklist } from '@ng-icons/tabler-icons';

@Component({
  selector: 'tkt-ticket-type-icon',
  imports: [NgIcon],
  viewProviders: [provideIcons({ tablerBug, tablerLayoutKanban, tablerSearch, tablerChecklist })],
  template: `<ng-icon name="tablerBug" size="18" strokeWidth="1.75" />`,
})
export class TicketTypeIcon {}
```

Filled variants come from `@ng-icons/tabler-icons/fill`.

**Drag and drop**: `@angular/cdk/drag-drop` 22.2.4. For kanban, use `cdkDropListGroup` with one `cdkDropList` per column, or `cdkDropListConnectedTo`. Signals plus zoneless work fine: update a `signal` in `(cdkDropListDropped)`, optimistically reorder, then call the API with `{ ticketId, beforeId, afterId, status }`. The **server** computes the rank (section 8).

**Charts**: pick **Chart.js 4.6.1 + ng2-charts 11.0.0**. Tree-shaken bundle measured with esbuild 0.28.2 (line + bar + tooltip + legend):

| Library | min | gzip |
|---|---|---|
| Chart.js 4.6.1 (registered controllers only) | 181 KB | **63 KB** |
| ECharts 6.1.0 (`echarts/core` + line/bar + grid/tooltip/legend + canvas) | 556 KB | 190 KB |

Why Chart.js:
- Both packages are MIT.
- It is 3x lighter than ECharts.
- It animates smoothly on canvas with a simple config.
- ECharts (Apache-2.0) only pays off for very large datasets and exotic chart types, which a ticket tracker (burndown, velocity, CFD, distribution) doesn't need.

How to use it:
- Register only the needed controllers: `provideCharts({ registerables: [LineController, BarController, ...] })`. Avoid `withDefaultRegisterables()`, which pulls everything.
- Lazy-load the reports route.
- Feed chart colors from `getComputedStyle(document.documentElement).getPropertyValue('--mat-sys-primary')` so charts follow the M3 theme and dark mode.

**Markdown**: pick **`marked` 18.1.2 + `DOMPurify` 3.4.17 behind a small `MarkdownPipe`** (26 KB gzip together), not `ngx-markdown` 22.1.1. `ngx-markdown` works (peer `marked ^17 || ^18`, Angular ^22) but adds wrapper/config surface for features we don't need (katex, mermaid, prism). A pipe gives full control over the extensions we will want: ticket-key autolinks, @mentions, task lists.

```ts
@Pipe({ name: 'markdown' })
export class MarkdownPipe implements PipeTransform {
  private readonly sanitizer = inject(DomSanitizer);
  transform(src: string | null | undefined): SafeHtml {
    const html = marked.parse(src ?? '', { async: false, gfm: true, breaks: true }) as string;
    return this.sanitizer.bypassSecurityTrustHtml(DOMPurify.sanitize(html));
  }
}
// <div class="md" [innerHTML]="ticket().description | markdown"></div>
```

`bypassSecurityTrustHtml` is only acceptable because DOMPurify ran first. Never bypass on unsanitized input.

**Unit tests**: `ng test` runs Vitest through `@angular/build:unit-test` (jsdom). Use `TestBed` as usual. Zoneless tests use `await fixture.whenStable()` instead of `fakeAsync`/`tick`.

---

## 8. Ordering: fractional indexing (backlog rank, board order)

**Recommendation: lexicographic fractional keys** (string `Rank`, `COLLATE "C"`), not float positions.

- A move updates exactly one row: `rank = KeyBetween(prev.Rank, next.Rank)`. There is no rebalancing in normal operation.
- Floats (`double`) run out of precision after about 50 bisections at the same spot. They then need a rebalance that rewrites many rows, which is racy and noisy for audit history.
- String keys grow by about one char per log62 bisections at the same spot. They only need an offline normalization pass if a key exceeds about 50 chars (a rare background job).
- The **server** computes the key from `beforeId`/`afterId`. Clients send neighbours, not ranks.
- Put a unique index on `(scope, Rank)`. If two concurrent moves into the same gap produce the same key, re-read the neighbours and retry once.
- Ticket creation appends with `KeyBetween(lastRank, null)` **inside** the numbering transaction, after the project row lock.
- One rank per ticket (Jira LexoRank style) can serve both backlog order and board-column order, because a column shows its tickets in global rank order. Whether boards need their own independent order is a product decision. If they do, add a `BoardRank` on the board-membership row.
- `.NET` comparisons must be `string.CompareOrdinal` / `StringComparer.Ordinal`, never culture-aware. In TypeScript, use plain `<` on strings.

C# port of the `fractional-indexing` npm package (CC0, v4.0.0 default base62 digits). **Parity verified on 11,000 generated cases against `fractional-indexing@4.0.0`**, so the frontend can use the npm package for optimistic previews with identical keys.

```csharp
/// <summary>Lexicographically sortable rank keys (port of npm fractional-indexing, base62). Compare ordinally.</summary>
public static class FractionalIndex
{
    private const string Digits = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private const string IntDigits = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    private const char Zero = '0';
    private static readonly string SmallestInteger = "A" + new string(Zero, 26);

    public static string KeyBetween(string? a, string? b)
    {
        if (a is not null) ValidateOrderKey(a);
        if (b is not null) ValidateOrderKey(b);
        if (a is not null && b is not null && string.CompareOrdinal(a, b) >= 0)
            throw new ArgumentException($"{a} >= {b}");

        if (a is null)
        {
            if (b is null) return "a" + Zero;
            var ib = IntegerPart(b);
            var fb = b[ib.Length..];
            if (ib == SmallestInteger) return ib + Midpoint("", fb);
            if (string.CompareOrdinal(ib, b) < 0) return ib;
            return DecrementInteger(ib) ?? throw new InvalidOperationException("Cannot decrement any more.");
        }

        if (b is null)
        {
            var ia = IntegerPart(a);
            return IncrementInteger(ia) ?? ia + Midpoint(a[ia.Length..], null);
        }

        var intA = IntegerPart(a);
        var intB = IntegerPart(b);
        if (intA == intB) return intA + Midpoint(a[intA.Length..], b[intB.Length..]);
        var next = IncrementInteger(intA) ?? throw new InvalidOperationException("Cannot increment any more.");
        return string.CompareOrdinal(next, b) < 0 ? next : intA + Midpoint(a[intA.Length..], null);
    }

    private static string Midpoint(string a, string? b)
    {
        if (b is not null && string.CompareOrdinal(a, b) >= 0) throw new ArgumentException($"{a} >= {b}");
        if (a.EndsWith(Zero) || (b is not null && b.EndsWith(Zero))) throw new ArgumentException("Trailing zero.");

        if (!string.IsNullOrEmpty(b))
        {
            var n = 0;
            while ((n < a.Length ? a[n] : Zero) == b[n]) n++;
            if (n > 0) return b[..n] + Midpoint(n < a.Length ? a[n..] : "", b[n..]);
        }

        var digitA = a.Length > 0 ? Digits.IndexOf(a[0]) : 0;
        var digitB = b is not null ? Digits.IndexOf(b[0]) : Digits.Length;
        if (digitB - digitA > 1)
            return Digits[(int)Math.Round(0.5 * (digitA + digitB), MidpointRounding.AwayFromZero)].ToString();
        if (b is { Length: > 1 }) return b[..1];
        return Digits[digitA] + Midpoint(a.Length > 0 ? a[1..] : "", null);
    }

    private static int IntegerLength(char head)
    {
        var i = IntDigits.IndexOf(head);
        if (i < 0) throw new ArgumentException($"Invalid order key head: {head}");
        const int half = 26;
        return i < half ? half - i + 1 : i - half + 2;
    }

    private static string IntegerPart(string key)
    {
        var length = IntegerLength(key[0]);
        if (length > key.Length) throw new ArgumentException($"Invalid order key: {key}");
        return key[..length];
    }

    private static void ValidateOrderKey(string key)
    {
        if (key == SmallestInteger) throw new ArgumentException($"Invalid order key: {key}");
        var i = IntegerPart(key);
        if (key.Length > i.Length && key[^1] == Zero) throw new ArgumentException($"Invalid order key: {key}");
    }

    private static string? IncrementInteger(string x) => Step(x, +1);
    private static string? DecrementInteger(string x) => Step(x, -1);

    private static string? Step(string x, int delta)
    {
        if (x.Length != IntegerLength(x[0])) throw new ArgumentException($"Invalid integer part: {x}");
        var wrap = delta > 0 ? Zero : Digits[^1];
        var trailing = "";
        for (var i = x.Length - 1; i >= 1; i--)
        {
            var d = Digits.IndexOf(x[i]) + delta;
            if (d == Digits.Length || d == -1) trailing = wrap + trailing;
            else return x[0] + x[1..i] + Digits[d] + trailing;
        }
        var headIndex = IntDigits.IndexOf(x[0]) + delta;
        if (headIndex < 0 || headIndex == IntDigits.Length) return null;
        var head = IntDigits[headIndex];
        var lengthDelta = IntegerLength(head) - IntegerLength(x[0]);
        return head + (lengthDelta > 0 ? trailing + wrap : lengthDelta < 0 ? trailing[1..] : trailing);
    }
}
```

Keep the parity test as a unit test: a JSON fixture generated by the npm package, asserted in xUnit. Note one difference: npm 4.0.0 silently swaps `a > b`, while this port throws.

---

## 9. Docker, compose, nginx

**API Dockerfile**:
- The runtime image is chiseled: non-root, no shell. The `-extra` variant includes ICU + tzdata. Plain chiseled/alpine images run in invariant globalization mode, which breaks culture formatting.
- ASP.NET images listen on **8080** (`ASPNETCORE_HTTP_PORTS`).

```dockerfile
FROM mcr.microsoft.com/dotnet/sdk:10.0.403-noble AS build
WORKDIR /src
COPY global.json Directory.Packages.props Directory.Build.props ./
COPY src/Ticketing.Api/Ticketing.Api.csproj src/Ticketing.Api/
RUN dotnet restore src/Ticketing.Api/Ticketing.Api.csproj
COPY src/ src/
RUN dotnet publish src/Ticketing.Api -c Release -o /app --no-restore

FROM mcr.microsoft.com/dotnet/aspnet:10.0.14-noble-chiseled-extra
WORKDIR /app
COPY --from=build /app .
ENTRYPOINT ["dotnet", "Ticketing.Api.dll"]
```

**Web Dockerfile** (Angular build + nginx):

```dockerfile
FROM node:24.22.1-alpine AS build
WORKDIR /web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ .
RUN npx ng build --configuration production

FROM nginxinc/nginx-unprivileged:1.30-alpine
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/dist/ticketing-web/browser /usr/share/nginx/html
```

**nginx.conf** (same origin: SPA, `/api`, `/mcp`):

```nginx
server {
  listen 8080;
  root /usr/share/nginx/html;

  location /api/ {
    proxy_pass http://api:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 25m;
  }

  location /mcp {
    proxy_pass http://api:8080;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Connection "";
    proxy_buffering off;            # MCP responses are SSE (server also sends X-Accel-Buffering: no)
    proxy_cache off;
    proxy_read_timeout 300s;        # SDK 2.3 holds headers until the first message
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
  location = /index.html { add_header Cache-Control "no-cache"; }
}
```

- In the API, set `ASPNETCORE_FORWARDEDHEADERS_ENABLED=true` so `Request.IsHttps`, the `Secure` cookie flag and the client IP are correct behind nginx/TLS.
- Map OpenAPI/Scalar under `/api` so nginx needs no extra locations: `app.MapOpenApi("/api/openapi/{documentName}.json")` and `app.MapScalarApiReference("/api/docs", o => o.WithOpenApiRoutePattern("/api/openapi/{documentName}.json"))` (Scalar's default prefix is `/scalar`).
- Expose these in Development (or for admins) only, if desired.

**docker-compose.yml**:

```yaml
services:
  db:
    image: postgres:18.6-alpine
    environment:
      POSTGRES_DB: ticketing
      POSTGRES_USER: ticketing
      POSTGRES_PASSWORD: ${DB_PASSWORD:-ticketing}
    volumes:
      - db-data:/var/lib/postgresql          # PG 18+: NOT /var/lib/postgresql/data (R7)
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 5s
      timeout: 3s
      retries: 20
      start_period: 10s

  api:
    build: { context: ., dockerfile: deploy/api.Dockerfile }
    environment:
      ConnectionStrings__Db: Host=db;Database=ticketing;Username=ticketing;Password=${DB_PASSWORD:-ticketing}
      ASPNETCORE_FORWARDEDHEADERS_ENABLED: "true"
      Database__MigrateOnStartup: "true"
    depends_on:
      db: { condition: service_healthy }

  web:
    build: { context: ., dockerfile: deploy/web.Dockerfile }
    ports: ["8080:8080"]
    depends_on: [api]

volumes:
  db-data:
```

The chiseled API image has no shell, curl or wget, so there's no container-level healthcheck for `api`. Expose `GET /api/health` (`MapHealthChecks` + `AddNpgSql`-style DB check, or a simple endpoint) and let Playwright / an external probe poll it through nginx.

---

## 10. Playwright e2e (1.64.1)

Layout at repo root: a separate npm package, so the Angular app's dependencies stay clean.

```
e2e/
  package.json            # @playwright/test 1.64.1, typescript
  playwright.config.ts
  tests/
    auth.setup.ts         # logs in once, saves storage state
    backlog.spec.ts
    board.spec.ts
  fixtures/api.ts         # seeding helpers via PAT (no XSRF needed)
  .auth/                  # gitignored storage state
```

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['junit', { outputFile: 'results.xml' }]] : 'list',
  use: { baseURL, trace: 'on-first-retry', screenshot: 'only-on-failure' },
  webServer: {
    command: 'docker compose -f ../docker-compose.yml up -d --build --wait',
    url: `${baseURL}/api/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'], storageState: '.auth/user.json' }, dependencies: ['setup'] },
  ],
});
```

```ts
// tests/auth.setup.ts
import { test as setup, expect } from '@playwright/test';
setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.E2E_USER ?? 'e2e@example.test');
  await page.getByLabel('Password').fill(process.env.E2E_PASSWORD ?? 'e2e-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('navigation')).toBeVisible();
  await page.context().storageState({ path: '.auth/user.json' });   // includes tkt_session + XSRF-TOKEN cookies
});
```

- Seed the e2e user from a dev seed file / migration when `ASPNETCORE_ENVIRONMENT=E2E`, not through the UI.
- Seed per-test data through the API with a PAT: `request.newContext({ baseURL, extraHTTPHeaders: { Authorization: `Bearer ${pat}` } })`. This avoids XSRF and is fast.
- Give each test unique project keys so `fullyParallel` is safe without DB resets.
- Install browsers with `npx playwright install --with-deps chromium`. In CI, run inside `mcr.microsoft.com/playwright:v1.64.1-noble` (the image version must match the npm version).

---

## Sources

- npm registry (`npm view`, `npm pack` tarball inspection): `@angular/*` 22.2.x, `@schematics/angular@22.2.4` (`ng-new`/`application` schema, latest-versions), `@angular/common@22.2.3` (XSRF interceptor source), `primeng@22.1.4` and `primeng@21.1.10` `LICENSE.md` (license rationale for R1), `fractional-indexing@4.0.0`; `@angular/material@22.2.4` (`_index.scss`, `core/tokens/_system.scss`, ng-add schema) and `@ng-icons/*@36.1.0` (jsDelivr file listings); registry `latest` metadata for licenses (`material-symbols` 0.48.1 = Apache-2.0, `@ng-icons/tabler-icons` = MIT)
- NuGet flat-container index and package XML docs: ModelContextProtocol.* 2.3.0, Microsoft.FeatureManagement* 4.8.0, Npgsql.EntityFrameworkCore.PostgreSQL 10.0.3, Scalar.AspNetCore 2.18.3, xunit.v3 4.0.2
- .NET release metadata: dotnetcli.blob.core.windows.net/dotnet/release-metadata/10.0/releases.json
- Angular releases and version compatibility: angular.dev/reference/releases, angular.dev/reference/versions
- Node schedule: github.com/nodejs/Release (schedule.json), nodejs.org/dist/index.json
- ASP.NET Core 10 breaking change, cookie redirects: learn.microsoft.com/dotnet/core/compatibility/aspnet-core/10/cookie-authentication-api-endpoints
- Npgsql EF 10 release notes: npgsql.org/efcore/release-notes/10.0.html
- MCP C# SDK releases: github.com/modelcontextprotocol/csharp-sdk/releases
- Claude Code MCP docs: code.claude.com/docs/en/mcp
- xUnit v3 4.0.0 release notes: xunit.net/releases/v3/4.0.0. Respawn releases: github.com/jbogard/Respawn/releases
- Postgres image docs (PG 18 PGDATA/volume): hub.docker.com/_/postgres. MCR and Docker Hub tag lists for image tags.
- Secondary (PrimeNG licensing coverage, price not verified on a primary source): dev.to/playfulprogramming-angular "ng-news 26-17"
