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
| Tickets | `search_tickets`, `get_ticket`, `get_children_graph` (children, the links among them and to outside tickets, with `blocked`; D-95), `create_ticket`, `create_tickets` (batch, all-or-nothing), `update_ticket`, `move_ticket` (`includeChildren` also moves the sub-tickets still in the place each ticket is leaving and not Done; D-107), `get_move_children` (preview of that), `delete_ticket`, `get_ticket_history`, `link_tickets`, `unlink_tickets` |
| Comments | `list_comments`, `add_comment`, `update_comment`, `delete_comment` |
| Watchers | `watch_ticket`, `unwatch_ticket` (the watcher list comes with `get_ticket`; `search_tickets` takes `watching: true`) |
| Notifications | `list_notifications` (`unreadOnly`, `cursor`, `limit`), `mark_notifications_read` (`ids` or `all: true`; write-scoped tokens only) |
| Attachments | `list_attachments`, `get_attachment_text` |
| Test cases | `list_test_cases`, `get_test_case`, `create_test_case`, `update_test_case` |
| Regressions | `list_regression_sessions`, `get_regression_session`, `start_regression_session`, `take_regression_item`, `assign_regression_item`, `record_regression_result` (optionally creates the bug), `complete_regression_session`, `cancel_regression_session` |
| Boards | `list_boards`, `get_board`, `create_board`, `update_board`, `archive_board` |
| Agents | `get_agent_prompt` (listed only while agent delegation is available to you: the `agent.delegate` flag is on and the instance has `TICKETING_PUBLIC_URL`) |

Inputs and outputs are specified in [spec §9](product/01-refined-spec.md#9-mcp-server). Tickets, test cases and sessions are referenced by key (`PAY-42`, `PAY-TC-7`, `PAY-R-3`); enum values are listed in each tool's description. Errors come back as `{ code, message, hint }`.

### Mentioning people

Descriptions (`create_ticket`, `create_tickets`, `update_ticket`) and comments (`add_comment`, `update_comment`) may mention users. Write either `@jane.doe@example.com` (the server stores it as a mention) or the stored form `@[Jane Doe](user:<id>)`; `find_users` with `projectKey` and `access: "Read"` lists who can be mentioned, with ids. A newly added mention notifies the user and makes them a watcher; a mention of someone who is inactive or cannot read the project fails with `mention.invalid`. An address that belongs to no user stays plain text, and mentions inside code are ignored. `get_ticket` returns `mentions` for the description and `list_comments` one per comment: the mentioned users who can read the project.

### Working on a ticket without the Delegate button

`get_agent_prompt` returns the prompt **Delegate to agent** would start Claude Code with: the project's template for the ticket's type (or the instance default) followed by the guardrails, plus which template version it came from. `get_project` shows the project's agent setup as `agent` (repository URL, default branch, merge policy); the setup itself changes only in the web app.

To start a session by hand with the same instructions, add a slash command to the repository, for example `.claude/commands/ticket.md`:

```markdown
Call the ticketing MCP tool get_agent_prompt with key "$ARGUMENTS" and follow the prompt it returns as your instructions.
```

Then `/ticket TKT-42` in Claude Code. A ticket whose project has no agent setup fails with `agent.project.disabled`, a ticket type the project switched off with `agent.type.off`.

Without a slash command, the same works as a one-off: start `claude` in your clone of the project's repository and send

```text
Call the ticketing MCP tool get_agent_prompt with key "TKT-42" and follow the prompt it returns as your instructions.
```

What to expect from the prompt it returns (spec §13.10):

- It first compares `git remote get-url origin` with the project's repository URL and stops if they differ, so start the session in the right clone. The comparison ignores case, scheme, user, port and `.git`, so an SSH clone of an HTTPS URL passes.
- It reads the ticket, its comments and its parent with `get_ticket`, follows the repository's `CLAUDE.md`, and keeps the status current over MCP. The token you connected with is the identity it works and comments as.
- It ends with one comment on the ticket that starts with `Delegated run · <Type> v<n> / <D|C>`, naming the template it ran.
- Whether it stops at Review or merges depends on the project's merge policy (`get_project` → `agent.mergePolicy`).
- The prompt is the same text **Copy prompt** gives on the ticket page; nothing is recorded in the ticket's history when you start a session this way.

### Tools that always ask first

`delete_ticket`, `delete_comment`, `unlink_tickets`, `cancel_regression_session` and `archive_board` are marked destructive (`destructiveHint`) and carry `_meta["anthropic/requiresUserInteraction"]: true`. Claude Code asks you before every call of these tools, even in a session where it otherwise runs tools without asking. Keep them out of allow lists; a delegated run has no reason to call them.

## Verified with a real client

On 2026-10-27 a headless Claude Code session (`claude -p --mcp-config …`) connected to a local stack with a fresh PAT and, using only these tools, created a project, an epic with two stories in one batch, updated fields, commented, created manual and automatic test cases, ran a regression session where a failure produced a linked bug, created a board, moved a ticket into a column, searched and read the dashboard statistics — 16 calls, no errors. The integration tests also exercise every tool through an MCP client (`tests/Ticketing.IntegrationTests`).
