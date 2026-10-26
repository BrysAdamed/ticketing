# 6. Schema migration policy

- Status: Accepted
- Date: 2026-10-26

## Context

Before v1 ships, no production database exists and the schema changes daily as features land. Several feature branches (often worked by parallel agents) add or change tables at the same time. EF Core migrations generated on parallel branches conflict in the model snapshot and accumulate dozens of throwaway steps. After v1, real data exists and every change must upgrade it in place. The spec requires migrations to be applied on API start ([spec §10](../product/01-refined-spec.md#10-non-functional-requirements)).

## Decision

**Until v1 is released:**

- There is exactly one migration, `InitialCreate`.
- Any schema change regenerates it: delete the migration and snapshot, run `dotnet ef migrations add InitialCreate`.
- When two branches both changed the schema, the second to merge resolves the conflict by taking the merged model and regenerating `InitialCreate` again. Nobody hand-merges the snapshot.
- Local and test databases are disposable: `docker compose down -v` or a fresh Testcontainers database.

**From the v1 release on:**

- `InitialCreate` is frozen. Every change is a new, normally additive migration with a descriptive name.
- Destructive changes (drop or rename a column, tighten a constraint) use expand and contract: add the new shape and backfill in one release, remove the old shape in a later one.
- A migration that rewrites data includes an integration test that runs it against seeded data.

**In both phases:**

- The API applies pending migrations on startup with `Database.MigrateAsync()`, controlled by `Database__MigrateOnStartup` (default `true`). EF Core 9+ takes a migration lock, so concurrent instances do not race.
- Integration tests also call `MigrateAsync()`, never `EnsureCreated()`, so the migration path is tested on every run ([ADR 0011](0011-testing-strategy.md)).
- `dotnet-ef` 10.0.14 is a local tool in the repository manifest.

## Consequences

- Branches stay mergeable and the v1 schema starts as one clean, readable migration.
- Until v1, pulling `main` may require dropping the local database. This is acceptable because there is no data worth keeping.
- The policy switch is a release step: tag v1, then freeze `InitialCreate`. Forgetting it would let someone regenerate a migration that production already ran. The release checklist must include it.
- Starting the API with a bad migration fails startup, which the readiness check and compose healthcheck surface immediately.

## Alternatives considered

- **Normal incremental migrations from day one.** Many trivial migrations and recurring snapshot conflicts between parallel branches, all for databases that hold no real data.
- **Migration bundle run as a separate compose job.** Cleaner separation, but one more moving part; the spec asks for migrations on API start. Can be revisited if multiple API instances or slow migrations make startup migration risky.
- **SQL-first tools (DbUp, Flyway).** Duplicates the EF model and loses snapshot diffing.
