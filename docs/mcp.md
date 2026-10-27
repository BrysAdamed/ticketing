# Using Ticketing from an LLM (MCP)

The API hosts an MCP server at `/mcp` (Streamable HTTP, stateless). It is authenticated with a personal access token (PAT) and runs every call as that token's user, with that user's permissions. REST and MCP call the same application handlers, so rules, validation and history are identical (ADR 0004).

## Connect Claude Code

1. In the web app open **Profile → Access tokens → New token**. Pick a name, scope (`ReadWrite` or `ReadOnly`) and expiry. The secret is shown once; the dialog also shows the ready-made command below.
2. Add the server:

```bash
claude mcp add --transport http ticketing https://<your-host>/mcp --header "Authorization: Bearer tkt_..."
```

Or commit-free, per project, in `.mcp.json` (keep the token out of git — reference an environment variable):

```json
{
  "mcpServers": {
    "ticketing": {
      "type": "http",
      "url": "https://<your-host>/mcp",
      "headers": { "Authorization": "Bearer ${TICKETING_TOKEN}" }
    }
  }
}
```

A `ReadOnly` token only lists and accepts the read tools. Tokens cannot manage users, tokens or feature flags; those stay in the web UI.

## Tools

| Area | Tools |
| --- | --- |
| Context | `whoami`, `find_users` |
| Projects | `list_projects`, `get_project`, `create_project`, `update_project`, `get_field_hints`, `get_project_stats` |
| Tickets | `search_tickets`, `get_ticket`, `create_ticket`, `create_tickets` (batch, all-or-nothing), `update_ticket`, `move_ticket`, `delete_ticket`, `get_ticket_history`, `link_tickets`, `unlink_tickets` |
| Comments | `list_comments`, `add_comment`, `update_comment`, `delete_comment` |
| Watchers | `watch_ticket`, `unwatch_ticket` (the watcher list comes with `get_ticket`; `search_tickets` takes `watching: true`) |
| Notifications | `list_notifications` (`unreadOnly`, `cursor`, `limit`), `mark_notifications_read` (`ids` or `all: true`; write-scoped tokens only) |
| Attachments | `list_attachments`, `get_attachment_text` |
| Test cases | `list_test_cases`, `get_test_case`, `create_test_case`, `update_test_case` |
| Regressions | `list_regression_sessions`, `get_regression_session`, `start_regression_session`, `take_regression_item`, `assign_regression_item`, `record_regression_result` (optionally creates the bug), `complete_regression_session`, `cancel_regression_session` |
| Boards | `list_boards`, `get_board`, `create_board`, `update_board`, `archive_board` |

Inputs and outputs are specified in [spec §9](product/01-refined-spec.md#9-mcp-server). Tickets, test cases and sessions are referenced by key (`PAY-42`, `PAY-TC-7`, `PAY-R-3`); enum values are listed in each tool's description. Errors come back as `{ code, message, hint }`.

### Mentioning people

Descriptions (`create_ticket`, `create_tickets`, `update_ticket`) and comments (`add_comment`, `update_comment`) may mention users. Write either `@jane.doe@example.com` (the server stores it as a mention) or the stored form `@[Jane Doe](user:<id>)`; `find_users` with `projectKey` and `access: "Read"` lists who can be mentioned, with ids. A newly added mention notifies the user and makes them a watcher; a mention of someone who is inactive or cannot read the project fails with `mention.invalid`. An address that belongs to no user stays plain text, and mentions inside code are ignored. `get_ticket` returns `mentions` for the description and `list_comments` one per comment: the mentioned users who can read the project.

## Verified with a real client

On 2026-10-27 a headless Claude Code session (`claude -p --mcp-config …`) connected to a local stack with a fresh PAT and, using only these tools, created a project, an epic with two stories in one batch, updated fields, commented, created manual and automatic test cases, ran a regression session where a failure produced a linked bug, created a board, moved a ticket into a column, searched and read the dashboard statistics — 16 calls, no errors. The integration tests also exercise every tool through an MCP client (`tests/Ticketing.IntegrationTests`).
