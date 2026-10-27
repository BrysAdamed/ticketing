# Ticketing

A lean, fast, LLM-friendly project and ticket tracker, built as an in-house replacement for Jira.

- **Projects** (public or private) with members and roles, a **backlog** with drag-and-drop ranking, and **tickets** with hierarchy (epic → story → task), links, markdown, comments, attachments and full history.
- **Boards** spanning several projects, with a column per status, swimlanes, quick filters and archive with carry-over.
- **Test cases and regression sessions**: manual cases wait for execution, automatic ones auto-pass, and a failed step turns into a pre-filled bug.
- **Project dashboards**, full-text **search** with shareable URLs and CSV export, **⌘K quick jump**, **My work**.
- **Users, roles and personal access tokens**, **feature flags** (user / role / percentage targeting, ready for A/B tests), and an admin audit log.
- **MCP server** at `/mcp`, so Claude Code (or any MCP client) can work with everything above — see [docs/mcp.md](docs/mcp.md).

Stack: .NET 10 (ASP.NET Core, EF Core) · Angular 22 + Angular Material · PostgreSQL 18 · nginx · Docker Compose.

## Quickstart (local)

Requirements: Docker. For development without containers also .NET SDK 10.0.300+ and Node 24.

```bash
cp .env.example .env          # set DB_PASSWORD and the bootstrap admin
docker compose up --build     # http://localhost:8080
```

Sign in with `TICKETING_BOOTSTRAP_ADMIN_EMAIL` / `TICKETING_BOOTSTRAP_ADMIN_PASSWORD` from `.env`. The first admin is created on startup while the user table is empty; create further users under **Admin → Users** (each gets a one-time set-password link).

**Try it with demo data:** on an empty database, set `TICKETING_SEED_DEMO=true` and `TICKETING_DEMO_PASSWORD=<12+ characters>` in `.env` before `docker compose up --build`. It creates 6 users, 3 projects (one private), ~180 tickets, two boards, test cases and regression sessions spread over the last 12 weeks. Sign in as `maya.kowalczyk@example.com` (or any other `@example.com` demo user) with that password. Seeding is a no-op once any project exists; one-off alternative: `docker compose run --rm api seed-demo`. For development and demos only.

`docker-compose.override.yml` is loaded automatically in development and additionally publishes the API on `:5080` (for `ng serve`) and PostgreSQL on `:5433`.

## Production (internal VM)

```bash
cp .env.example .env          # strong DB_PASSWORD, real admin, ASPNETCORE_ENVIRONMENT=Production
docker compose -f docker-compose.yml up -d --build
```

- Only the `web` service (nginx) is published, on `WEB_HOST_PORT` (default 8080). The API and database stay on the compose network.
- Terminate TLS in front of nginx (reverse proxy or load balancer) and set `COOKIE_SECURE_POLICY=Always`. HSTS is sent when the request arrived over HTTPS.
- `TICKETING_TRUSTED_PROXIES` lists the networks whose `X-Forwarded-For` the API believes (the compose network by default); client IPs drive login rate limiting.
- Migrations run on API start. Back up with `pg_dump` (attachments live in the database) — see [ADR 0012](docs/adr/0012-deployment-docker-compose.md).

## Connect Claude Code

Create a token in **Profile → Access tokens**, then:

```bash
claude mcp add --transport http ticketing https://<your-host>/mcp --header "Authorization: Bearer tkt_..."
```

Details and the tool list: [docs/mcp.md](docs/mcp.md). REST: OpenAPI at `/api/v1/openapi.json` (signed-in users), Scalar UI at `/scalar` outside Production.

## Development

```bash
dotnet build && dotnet test                     # API, unit + integration tests (Testcontainers, needs Docker)
cd web && npm ci && npm start                   # SPA on :4200, proxied to the API on :5080
cd web && npm test && npm run lint && npm run build
cd e2e && npm ci && npx playwright install chromium && npx playwright test   # against the running stack
```

Guides: [backend](docs/development/backend.md) · [frontend](docs/development/frontend.md) · [feature slice playbook](docs/development/slice-playbook.md) · [CLAUDE.md](CLAUDE.md) for coding agents.

## Documentation

| | |
| --- | --- |
| Product | [original brief](docs/product/00-original-brief.md) · [v1 spec](docs/product/01-refined-spec.md) · [improvements triage](docs/product/02-improvements-triage.md) |
| Decisions | [decision log](docs/decisions.md) · [ADRs](docs/adr/README.md) · [ideas backlog](docs/ideas.md) |
| Domain | [glossary](docs/glossary.md) · [workflows](docs/domain/workflows.md) |
| Architecture | [overview](docs/architecture/overview.md) · [API conventions](docs/architecture/api-conventions.md) · [search URL format](docs/architecture/search-url-format.md) |
| Design | [design system](docs/design/design-system.md) · [screens](docs/design/layout-and-screens.md) · [mockups](docs/design/mockups/) |
