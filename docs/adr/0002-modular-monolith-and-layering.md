# 2. Modular monolith with Domain / Application / Infrastructure / Api layering

- Status: Accepted
- Date: 2026-10-26

## Context

One small team builds and runs the system on a single VM ([spec §1](../product/01-refined-spec.md#1-scope-of-v1), D-03). The same use cases must be reachable from three places: the Angular UI, the REST API and the MCP server ([spec §8](../product/01-refined-spec.md#8-rest-api): "No business rule lives in either transport"). Behaviour must be identical across them, including permission checks and error codes. Scale (D-04) does not justify distributed services.

## Decision

- **One deployable**, `Ticketing.Api`, built from four projects ([architecture overview](../architecture/overview.md)):
  - `Ticketing.Domain`: entities, value objects, enums, invariants (for example parent depth, resolution rules, rank keys). No dependencies on other projects or on EF Core.
  - `Ticketing.Application`: one folder per feature (`Tickets`, `Boards`, `TestCases`, `Regressions`, `Projects`, `Users`, `Tokens`, `Flags`, `Search`, `Dashboard`, `Activity`). Holds use cases, DTOs, validation and abstractions (`ICurrentUser`, `IProjectAccess`, `IActivityLog`, `IAttachmentStore`, `IClock`).
  - `Ticketing.Infrastructure`: EF Core `DbContext`, configurations, migrations, auth handlers, hashing, the feature-flag provider, implementations of the Application abstractions.
  - `Ticketing.Api`: the composition root. Minimal API endpoints, MCP tools, auth wiring, OpenAPI.
- Dependencies point inward: Api → Application + Infrastructure, Infrastructure → Application → Domain.
- **Features are modules by folder**, not by assembly. A feature does not reach into another feature's handlers; it uses Domain types or a query exposed by the other feature.
- **One handler per use case.** A file such as `Application/Tickets/CreateTicket.cs` holds the request record, its validator and a plain `CreateTicketHandler` class with one `HandleAsync(request, ct)` method. Handlers are registered by assembly scanning. **No mediator library**: endpoints and tools inject the handler they call directly.
- **REST and MCP call the same handlers.** An endpoint or tool only translates transport to request and result to transport. Authorization (`IProjectAccess`), validation, activity logging, the write channel (`Web`/`Api`/`Mcp`, read from `ICurrentUser`) and transactions all happen inside the handler, so no transport can skip them.
- **Errors** are raised as application errors carrying a stable code from the spec (for example `ticket.parent.cycle`). REST maps them to RFC 9457 problem details; MCP maps them to `isError: true` with `{ code, message, hint }` ([spec §2](../product/01-refined-spec.md#2-cross-cutting-conventions), [§9.2](../product/01-refined-spec.md#92-conventions-for-all-tools)). Private projects the caller cannot read produce "not found", never "forbidden" ([§5.1](../product/01-refined-spec.md#51-effective-project-access)).
- Reads project straight to DTOs with `AsNoTracking`. Writes load the aggregate, call domain methods, save once.

## Consequences

- A rule fixed in a handler is fixed for the UI, REST and MCP at once. Integration tests can target handlers through REST and trust MCP to match, plus a thin MCP contract test.
- Without a mediator pipeline, cross-cutting steps (validation, access check, activity log, save) are explicit calls in each handler. That is some repetition, but every step is visible when reading one file. If repetition grows, a small base class or decorator may be introduced by a later ADR.
- A future split into services would follow the feature folders, but nothing in v1 prepares for it beyond keeping features apart.
- Folder-based modules are a convention. An architecture test (for example, Domain references no EF Core, Api has no `DbContext` usage outside composition) keeps the layering honest.

## Alternatives considered

- **Microservices per feature.** Network calls, distributed transactions (ticket creation from a regression failure spans two features) and more containers on one VM, for no scale benefit.
- **MediatR or a similar mediator.** Adds indirection and, since 2025, a commercial license for MediatR. Pipeline behaviours are its main benefit, and we prefer explicit calls.
- **Business logic in endpoints, MCP wrapping REST over HTTP.** Doubles the latency of every tool call and splits auth context. D-36 already rejected an out-of-process MCP wrapper.
- **Separate assemblies per feature.** More project files and build time; folder conventions plus an architecture test give most of the benefit.
