# Architecture Decision Records

Technical decisions for Ticketing, in Michael Nygard's format (see [ADR 0001](0001-record-architecture-decisions.md)). Product decisions live in [../decisions.md](../decisions.md); the normative behaviour is in [../product/01-refined-spec.md](../product/01-refined-spec.md). Version facts and verified snippets are in [../research/tech-stack.md](../research/tech-stack.md).

| # | Title | Status |
| --- | --- | --- |
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-modular-monolith-and-layering.md) | Modular monolith with Domain / Application / Infrastructure / Api layering; one handler per use case; REST and MCP share handlers | Accepted |
| [0003](0003-authentication-cookie-and-pat.md) | Authentication: cookie session for the SPA, personal access tokens for REST and MCP | Accepted |
| [0004](0004-in-process-mcp-server.md) | MCP server hosted in-process at `/mcp` | Accepted |
| [0005](0005-postgresql-and-ef-core.md) | PostgreSQL with EF Core (Npgsql) | Accepted |
| [0006](0006-schema-migration-policy.md) | Schema migration policy | Accepted |
| [0007](0007-feature-flags.md) | Feature flags with Microsoft.FeatureManagement and a database-backed provider | Accepted |
| [0008](0008-ab-ready-views.md) | A/B-ready views: view registry, store + view split | Accepted |
| [0009](0009-frontend-stack.md) | Frontend: Angular 22 with Angular Material, Tabler icons, Chart.js and marked | Accepted |
| [0010](0010-fractional-index-ranking.md) | Ordering with fractional-index rank keys | Accepted |
| [0011](0011-testing-strategy.md) | Testing strategy | Accepted |
| [0012](0012-deployment-docker-compose.md) | Deployment with Docker Compose | Accepted |

To add a decision, copy the structure of an existing ADR, take the next number, set Status to `Proposed`, and add a row here. Never renumber or rewrite an accepted ADR; supersede it.
