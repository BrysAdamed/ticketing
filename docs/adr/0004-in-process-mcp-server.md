# 4. MCP server hosted in-process at `/mcp`

- Status: Accepted
- Date: 2026-10-26

## Context

A main goal of the product is easy integration with LLM clients such as Claude Code ([brief](../product/00-original-brief.md)). The MCP server must expose the same use cases as the REST API with the same permissions ([spec §9](../product/01-refined-spec.md#9-mcp-server)). D-36 chose an HTTP endpoint inside the API over a local stdio wrapper. The MCP spec revision 2026-07-28 removed protocol sessions, and the C# SDK 2.x defaults to stateless HTTP ([tech-stack.md](../research/tech-stack.md) §2, red flag R8).

## Decision

- Use `ModelContextProtocol.AspNetCore` 2.3.0 inside `Ticketing.Api`: `AddMcpServer().WithHttpTransport(o => o.Stateless = true).AddAuthorizationFilters().WithToolsFromAssembly()` and `MapMcp("/mcp")`.
- **Transport:** Streamable HTTP, **stateless**. Every tool call runs inside its own HTTP request, so scoped services (`DbContext`, `ICurrentUser`) work as in REST. Server-to-client features (sampling, elicitation, roots) are not used.
- **Auth: PAT only.** `/mcp` requires a policy pinned to the PAT scheme. A browser cookie gets `401`, which also shuts out cookie-riding CSRF and DNS-rebinding attacks. Clients connect with `claude mcp add --transport http ticketing https://<host>/mcp --header "Authorization: Bearer tkt_..."`.
- **Tools** live in `Api/Mcp/<Feature>Tools.cs`, one class per feature, and call the Application handlers from [ADR 0002](0002-modular-monolith-and-layering.md). The tool set, names and inputs are those of [spec §9.3](../product/01-refined-spec.md#93-tools).
- **Scope filtering:** write tools carry `[Authorize(Policy = "Write")]`. `AddAuthorizationFilters()` hides them from `tools/list` for `ReadOnly` tokens and rejects direct calls.
- **Annotations:** read tools set `ReadOnly = true`; `delete_ticket`, `delete_comment`, `unlink_tickets`, `cancel_regression_session` and `archive_board` set `Destructive = true`.
- **Errors:** a shared wrapper turns application errors into a tool result with `isError: true` and JSON `{ code, message, hint }`. Unexpected exceptions return a generic error and are logged.
- **Proxy:** nginx proxies `/mcp` with buffering off and a 300 s read timeout, because SDK 2.3 holds response headers until the first message and responses may be SSE.
- Rate limiting and the `Mcp` write channel apply as in [ADR 0003](0003-authentication-cookie-and-pat.md).

## Consequences

- Users install nothing; one deployment serves UI, REST and MCP.
- MCP and REST cannot drift in behaviour, because neither holds rules. They can drift in shape, so a contract test lists the registered tools and their annotations against spec §9.3.
- Stateless mode scales to several API instances without session affinity.
- Tool descriptions are part of the product: they list allowed enum values so the model does not guess (spec §9.2). Changing them is a reviewed change.
- No MCP OAuth discovery is needed; Claude Code sends the configured header and treats `401` as a failed connection.

## Alternatives considered

- **Local stdio server wrapping REST.** Requires installing and updating a binary on every developer machine, and doubles the hop count (D-36).
- **Stateful Streamable HTTP.** Needed only for server-initiated requests, which no v1 tool uses. It refuses clients on the 2026-07-28 protocol and needs session affinity.
- **Separate MCP process.** Another container and a second copy of the auth wiring for no isolation benefit.
- **Cookie or OAuth for MCP.** Cookies invite CSRF; a full OAuth authorization server is out of scope for v1. PATs are already required by the brief.
