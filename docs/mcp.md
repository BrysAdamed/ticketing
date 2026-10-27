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
| Tickets | `search_tickets`, `get_ticket`, `get_children_graph` (children, the links among them and to outside tickets, with `blocked`; D-95), `create_ticket`, `create_tickets` (batch, all-or-nothing), `update_ticket`, `move_ticket`, `delete_ticket`, `get_ticket_history`, `link_tickets`, `unlink_tickets` |
| Comments | `list_comments`, `add_comment`, `update_comment`, `delete_comment` |
| Watchers | `watch_ticket`, `unwatch_ticket` (the watcher list comes with `get_ticket`; `search_tickets` takes `watching: true`) |
| Notifications | `list_notifications` (`unreadOnly`, `cursor`, `limit`), `mark_notifications_read` (`ids` or `all: true`; write-scoped tokens only) |
| Attachments | `list_attachments`, `get_attachment_text` (ticket and page attachments) |
| Test cases | `list_test_cases`, `get_test_case`, `create_test_case`, `update_test_case` |
| Regressions | `list_regression_sessions`, `get_regression_session`, `start_regression_session`, `take_regression_item`, `assign_regression_item`, `record_regression_result` (optionally creates the bug), `complete_regression_session`, `cancel_regression_session` |
| Boards | `list_boards`, `get_board`, `create_board`, `update_board`, `archive_board` |
| Docs | `list_docs`, `get_doc` (by `docKey`, or `projectKey` + `path`; optional `version`), `get_doc_history`, `search_docs`, `list_doc_attachments`, `list_doc_comments`, `create_folder`, `create_page`, `create_diagram`, `update_doc`, `edit_doc` (find/replace), `restore_doc_version`, `move_doc`, `delete_doc`, `add_doc_comment`, `update_doc_comment`, `delete_doc_comment` |

Inputs and outputs are specified in [spec §9](product/01-refined-spec.md#9-mcp-server) and [§12](product/01-refined-spec.md#12-docs). Tickets, test cases, sessions and docs are referenced by key (`PAY-42`, `PAY-TC-7`, `PAY-R-3`, `PAY-D-12`); enum values are listed in each tool's description. Errors come back as `{ code, message, hint }`, plus details where a code has them (`doc.version.conflict` adds `currentVersion`, `updatedBy` and `updatedAt`).

### Docs

Each project has a docs tree of folders, markdown pages and diagrams, up to 6 levels deep. A doc is addressed by its key (`WEB-D-12`) or by its path: titles joined by `/`, case-insensitive, with a `/` inside a title written `\/` (`Architecture/ADRs/0001 Use Postgres`). Titles are unique within a folder, ignoring case, so a path always names one doc.

- Find docs with `search_docs`: `text` searches titles, the latest published content and Canvas labels in every readable project (drafts never), best match first; filter by `projectKeys`, `kinds`, `folder` (a folder key: its whole subtree), `mentions` (a ticket key) or `updatedFrom`/`updatedTo`. Without `text`, or with `sort: "Updated"`, results come newest first with a `cursor`. Each hit has a plain-text `snippet` with `highlights` (`start`, `length`).
- Read with `get_doc`; its `content` is raw markdown and its `version` is the content version.
- Replace the whole content with `update_doc` and `baseVersion` = the version you read. If someone published in between, the call fails with `doc.version.conflict` and the current version, author and time: read again, merge, retry.
- For small changes to long pages use `edit_doc`: `edits: [{ oldText, newText, replaceAll? }]` (1..50) are applied in order to the latest version as one new version, with no `baseVersion`, so they compose with other people's edits. Every `oldText` must match exactly (whitespace and line breaks included) and once, unless `replaceAll`; otherwise `doc.edit.noMatch` / `doc.edit.ambiguous` and nothing changes.
- A rename (`update_doc` with only `title`) and `move_doc` create no version. Deleting a folder deletes its subtree; Members can delete only docs they created and empty folders. Undo and the trash are in the web app and the REST API only.
- `get_doc_history` lists a doc's versions (`type: "Version"`: `version`, `title`, `changeNote`, `restoredFrom`, `actor`, `channel`) and its other changes (`type: "Activity"`: `action` such as `doc.renamed` or `doc.moved`, with `oldValue`/`newValue`), newest first with a `cursor`. Read an old version with `get_doc` and `version`: `content` is then that version's and `atVersion` describes it, while `version` stays the latest (use it as `baseVersion`). `restore_doc_version` publishes an old version's title and content again as a new version (nothing is lost, no `baseVersion` needed); restoring what the latest version already is changes nothing, so a retry is safe.
- Diagrams: `create_diagram` with `format: "Mermaid"` (the default) and the Mermaid text as `source`. Supported types: `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`, `mindmap`. The server does not check the syntax; a diagram that does not parse shows the parser error in the web app until it is fixed, so keep the source simple and check it before sending. A diagram's `content` (in `get_doc`, `update_doc`, `edit_doc`) is its source. Pages embed a diagram doc with `![caption](WEB-D-12)` and can also hold inline ```` ```mermaid ```` blocks. Canvas diagrams (Excalidraw JSON) are meant for drawing in the web app; prefer Mermaid when you write a diagram.
- Unpublished drafts are a web feature: MCP writes publish directly, and the publisher's own draft of that doc is discarded.
- Images and files on a page are attachments, embedded in the markdown as `![name](/api/v1/attachments/{id})`. `list_doc_attachments` lists them with their download URLs; `get_attachment_text` reads text, CSV and JSON ones, as for tickets. Uploading is web and REST only.
- Pages and diagrams have a comment thread: `list_doc_comments` (oldest first, paged), `add_doc_comment`, `update_doc_comment` (your own) and `delete_doc_comment` (your own; Owners any) with the ticket comment rules. Comments create no version. A new comment notifies the doc's author and earlier commenters (`list_notifications` items then carry `doc` instead of `ticket`). Doc comment ids and ticket comment ids are not interchangeable.

### Mentioning people

Descriptions (`create_ticket`, `create_tickets`, `update_ticket`) and comments (`add_comment`, `update_comment`) may mention users. Write either `@jane.doe@example.com` (the server stores it as a mention) or the stored form `@[Jane Doe](user:<id>)`; `find_users` with `projectKey` and `access: "Read"` lists who can be mentioned, with ids. A newly added mention notifies the user and makes them a watcher; a mention of someone who is inactive or cannot read the project fails with `mention.invalid`. An address that belongs to no user stays plain text, and mentions inside code are ignored. `get_ticket` returns `mentions` for the description and `list_comments` one per comment: the mentioned users who can read the project.

## Verified with a real client

On 2026-10-27 a headless Claude Code session (`claude -p --mcp-config …`) connected to a local stack with a fresh PAT and, using only these tools, created a project, an epic with two stories in one batch, updated fields, commented, created manual and automatic test cases, ran a regression session where a failure produced a linked bug, created a board, moved a ticket into a column, searched and read the dashboard statistics — 16 calls, no errors. The integration tests also exercise every tool through an MCP client (`tests/Ticketing.IntegrationTests`).
