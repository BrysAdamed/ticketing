# 12. Deployment with Docker Compose

- Status: Accepted
- Date: 2026-10-26

## Context

The product owner chose Docker Compose on an internal VM (D-03). The spec requires `api`, `web` and `db` services, `/health/live` and `/health/ready`, structured JSON logs, migrations on API start and a documented `pg_dump` backup that includes attachments ([spec §10](../product/01-refined-spec.md#10-non-functional-requirements)). The SPA and API must be same-origin so the session cookie and XSRF work without CORS ([ADR 0003](0003-authentication-cookie-and-pat.md)).

## Decision

**Services** (`docker-compose.yml` at the repository root, Dockerfiles in `deploy/`):

| Service | Image | Role |
| --- | --- | --- |
| `db` | `postgres:18-alpine` (patch pinned) | The only stateful service. Named volume mounted at `/var/lib/postgresql` (PostgreSQL 18 changed the data path, research R7). Not published to the host. |
| `api` | built from `mcr.microsoft.com/dotnet/aspnet:10.0-noble-chiseled-extra` | ASP.NET Core on port 8080: REST, MCP, background jobs. Non-root, no shell. Not published to the host. |
| `web` | built from `nginxinc/nginx-unprivileged:1.30-alpine` | Serves the compiled Angular app and reverse-proxies `/api`, `/mcp` and `/health` to `api`. The only published port; `docker-compose.override.yml` (development only) also publishes `api` and `db`. |
| `pdf` | `gotenberg/gotenberg:8.39.0-chromium` | PDF export renderer (added by TKT-20, [ADR 0013](0013-diagram-editor-and-pdf-pipeline.md), D-116). On the internal `render` network shared only with `api`: no published port, no egress, basic auth with `PDF_RENDERER_PASSWORD`, read-only root, 1.5 GB memory limit. Stateless, so it needs no backup. Without the password it idles and PDF export answers 503. |

**Routing and TLS.** nginx makes the SPA, REST and MCP one origin. `/mcp` is proxied with buffering off and a 300 s read timeout ([ADR 0004](0004-in-process-mcp-server.md)). `index.html` is served `no-cache`; hashed assets are cached long-term. TLS terminates at a company reverse proxy in front of `web` (or at `web` with a mounted certificate); nginx passes the proxy's `X-Forwarded-Proto` on and sends HSTS only over HTTPS. The API believes `X-Forwarded-For`/`-Proto` only from the trusted proxy ranges in `ForwardedHeaders__KnownNetworks`, so `Secure` cookies and client IPs are correct and cannot be spoofed by a direct caller (D-73).

**Health checks.**

- `/health/live`: process is up, no dependencies checked.
- `/health/ready`: database reachable and migrations applied.
- `db` compose healthcheck: `pg_isready`. `api` starts after `db` is healthy.
- The chiseled `api` image has no shell or curl, so it has no container-level healthcheck. The `web` healthcheck calls `/health/ready` through nginx, which covers nginx, the API and the database in one probe. External monitoring polls the same URL.

**Configuration** comes only from environment variables (an `.env` file next to the compose file, not committed): `ConnectionStrings__Db`, `DB_PASSWORD`, `TICKETING_BOOTSTRAP_ADMIN_EMAIL`, `TICKETING_BOOTSTRAP_ADMIN_PASSWORD` ([spec §6.14](../product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)), `Database__MigrateOnStartup` ([ADR 0006](0006-schema-migration-policy.md)), `TICKETING_TRUSTED_PROXIES` and `TICKETING_FORWARD_LIMIT` (D-73), `PDF_RENDERER_PASSWORD` (D-116), and the public base URL used in set-password links and the MCP config snippet. A `.env.example` lists them all. The ASP.NET Core data-protection key ring (cookie and antiforgery encryption) is persisted to a named volume or the database, so restarts do not sign everyone out.

**Logs.** The API writes structured JSON to stdout; Docker's log driver collects it.

**Backups.** A host cron job runs nightly `docker compose exec -T db pg_dump -Fc -U ticketing ticketing > ticketing-<date>.dump` to a backup directory that is copied off the VM, keeping 14 daily and 8 weekly dumps. Attachments are in the database (D-15), so the dump is complete. The restore procedure (`pg_restore --clean` into the `db` service while `api` is stopped) is documented next to the compose file and rehearsed before go-live.

**Release.** Images are built from tagged commits. Upgrade = `docker compose pull && docker compose up -d`; the API migrates on start.

## Consequences

- One VM, one command to start, one dump file to back up.
- Single API instance and single database: no high availability. A VM failure means restoring the latest dump; up to one day of data is at risk unless backups run more often or WAL archiving is added.
- Database size grows with attachments; backup duration must be watched. Moving attachments out of PostgreSQL is possible behind `IAttachmentStore`.
- Configuration through environment variables keeps secrets out of images, but the `.env` file on the VM must be readable only by the deploying account.

## Alternatives considered

- **Kubernetes.** Operational weight far beyond one VM and one team.
- **Run migrations as a separate one-shot compose service.** Cleaner separation; rejected for v1 because the spec asks for migrations on API start (see ADR 0006).
- **API serving the SPA (no nginx).** One container fewer, but nginx gives static-file caching, compression and TLS termination for free and keeps the API image minimal.
- **Volume-level snapshots instead of `pg_dump`.** Need filesystem support on the VM and are not portable; `pg_dump` is required by the spec.
- **Debian-based API image with curl for a healthcheck.** Larger attack surface for one probe; the `web` probe through nginx covers it.
