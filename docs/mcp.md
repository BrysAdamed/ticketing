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

### The Connect an AI agent guide

The web app walks you through the same steps: **Help → Connect an AI agent** (also in the command palette, from the empty Access tokens page and from the two optional "Connect an AI agent" items of the getting-started checklist). It opens a panel on **Profile → Access tokens** with three steps (spec 14.8, D-141):

1. **Create a token.** Opens the usual Generate token dialog with the name "Claude Code" filled in.
2. **Copy the command.** The `claude mcp add` command above, with the new token in it. The secret stays in the page only while the guide is open, as in the show-once dialog. If you already have a token, the command shows `tkt_...` for you to replace.
3. **Check the connection.** Run the command, start Claude Code and ask it to call `whoami`. The guide asks the server every 5 seconds whether the token has been used (its **Last used** is set) and turns green when it has; it stops asking when the check passes or the guide closes. The checklist's "Confirm the connection" ticks off from the same fact.

## Server instructions

On `initialize` the server sends the agent this primer (`McpServerOptions.ServerInstructions`, kept in `src/Ticketing.Api/Mcp/McpServerInstructions.cs`). It is sent on every connection, so it stays short; an integration test keeps the copy below identical to the code.

<!-- mcp-server-instructions:start -->
```text
Ticketing is the team's issue tracker. Every call runs as the user who owns your access token, with their permissions.

- Call `whoami` first: it returns who you act as, their global role and your token scope (a ReadOnly token cannot write).
- Keys: tickets `WEB-42`, test cases `WEB-TC-7`, regression sessions `WEB-R-3`, docs `WEB-D-12`. Project keys never change; refer to things by key.
- Statuses: ToDo, InProgress, OnHold, Review, ReadyForTesting, Testing, ReadyForDeploy, Done. Transitions are free: set any status from any status with `update_ticket`; there is no workflow to follow.
- Backlog vs boards: a ticket lives in exactly one place, its project's backlog or one board. New tickets land in the backlog; `move_ticket` moves them between the backlog and boards (a board's columns are the statuses).
- Not found can mean no access: private projects you cannot read, and everything in them, answer not found exactly like keys that do not exist.
- Retries: create tools take `idempotencyKey`; repeating a call with the same key within 24 hours returns the original result instead of a duplicate. `update_ticket` takes `expectedVersion` to avoid overwriting someone else's change.
- Errors come back as `{ code, message, hint }`; the hint says how to fix the call. Tool descriptions list the allowed values of every enum.
- More: docs/mcp.md in the Ticketing repository, and Help → Connect an AI agent in the web app.
```
<!-- mcp-server-instructions:end -->

## Tools

| Area | Tools |
| --- | --- |
| Context | `whoami`, `find_users` |
| Projects | `list_projects`, `get_project`, `create_project`, `update_project`, `get_field_hints`, `get_project_stats` |
| Tickets | `search_tickets`, `get_ticket`, `get_children_graph` (children, the links among them and to outside tickets, with `blocked`; D-95), `create_ticket`, `create_tickets` (batch, all-or-nothing), `update_ticket`, `move_ticket` (`includeChildren` also moves the sub-tickets still in the place each ticket is leaving and not Done; D-107), `get_move_children` (preview of that), `delete_ticket`, `get_ticket_history`, `link_tickets`, `unlink_tickets` |
| Comments | `list_comments`, `add_comment`, `update_comment`, `delete_comment` |
| Watchers | `watch_ticket`, `unwatch_ticket` (the watcher list comes with `get_ticket`; `search_tickets` takes `watching: true`) |
| Notifications | `list_notifications` (`unreadOnly`, `cursor`, `limit`), `mark_notifications_read` (`ids` or `all: true`; write-scoped tokens only) |
| Attachments | `list_attachments`, `get_attachment_text` (ticket and page attachments) |
| Test cases | `list_test_cases`, `get_test_case`, `create_test_case`, `update_test_case` |
| Regressions | `list_regression_sessions`, `get_regression_session`, `start_regression_session`, `take_regression_item`, `assign_regression_item`, `record_regression_result` (optionally creates the bug), `complete_regression_session`, `cancel_regression_session` |
| Boards | `list_boards`, `get_board`, `create_board`, `update_board`, `archive_board` |
| Docs | `list_docs`, `get_doc` (by `docKey`, or `projectKey` + `path`; optional `version`), `get_doc_history`, `get_doc_export_link`, `search_docs`, `list_doc_attachments`, `list_doc_comments`, `create_folder`, `create_page`, `create_diagram`, `update_doc`, `edit_doc` (find/replace), `restore_doc_version`, `move_doc`, `delete_doc`, `add_doc_comment`, `update_doc_comment`, `delete_doc_comment` |
| Achievements | `list_my_achievements` (your own achievements only: the catalogue with the tiers you earned, when, and your live progress; secret ones masked until earned. Listed only while the `achievements` flag is on for you; after an opt-out it fails with `achievements.disabled`) |
| Agents | `get_agent_prompt` (listed only while agent delegation is available to you: the `agent.delegate` flag is on and the instance has `TICKETING_PUBLIC_URL`) |

Inputs and outputs are specified in [spec §9](product/01-refined-spec.md#9-mcp-server) and [§12](product/01-refined-spec.md#12-docs). Tickets, test cases, sessions and docs are referenced by key (`PAY-42`, `PAY-TC-7`, `PAY-R-3`, `PAY-D-12`); enum values are listed in each tool's description. Onboarding state (guides a user completed or dismissed) has no tools: it is personal UI state, readable with a PAT at `GET /api/v1/me/onboarding` and writable only from the web session (D-132). Errors come back as `{ code, message, hint }`, plus details where a code has them (`doc.version.conflict` adds `currentVersion`, `updatedBy` and `updatedAt`).

### Docs

Each project has a docs tree of folders, markdown pages and diagrams, up to 6 levels deep. A doc is addressed by its key (`WEB-D-12`) or by its path: titles joined by `/`, case-insensitive, with a `/` inside a title written `\/` (`Architecture/ADRs/0001 Use Postgres`). Titles are unique within a folder, ignoring case, so a path always names one doc.

- Find docs with `search_docs`: `text` searches titles, the latest published content and Canvas labels in every readable project (drafts never), best match first; filter by `projectKeys`, `kinds`, `folder` (a folder key: its whole subtree), `mentions` (a ticket key) or `updatedFrom`/`updatedTo`. Without `text`, or with `sort: "Updated"`, results come newest first with a `cursor`. Each hit has a plain-text `snippet` with `highlights` (`start`, `length`).
- Read with `get_doc`; its `content` is raw markdown and its `version` is the content version. It also returns what the content links to, resolved for you: `references.tickets` (key, title, type, status), `references.docs` (a deleted one only as `{ key, deleted: true }`), `embeds` (diagrams embedded with `![caption](WEB-D-7)`, Mermaid with its `content`) and `backlinks` (`{ total, items }`: docs linking here). Tickets and docs you cannot read are left out.
- Link from a page by writing keys: a ticket key (`WEB-42`) shows as a ticket chip with its status, a doc key or `[text](WEB-D-12)` as a link, and `![caption](WEB-D-7)` embeds a diagram. Keys inside code are not links. Every publish re-indexes them, so `get_ticket` (its `docs`: the 20 latest docs mentioning the ticket, plus `total`; `include: ["docs"]` to ask for it alone) and `search_docs` with `mentions` find the page at once.
- Replace the whole content with `update_doc` and `baseVersion` = the version you read. If someone published in between, the call fails with `doc.version.conflict` and the current version, author and time: read again, merge, retry.
- For small changes to long pages use `edit_doc`: `edits: [{ oldText, newText, replaceAll? }]` (1..50) are applied in order to the latest version as one new version, with no `baseVersion`, so they compose with other people's edits. Every `oldText` must match exactly (whitespace and line breaks included) and once, unless `replaceAll`; otherwise `doc.edit.noMatch` / `doc.edit.ambiguous` and nothing changes.
- A rename (`update_doc` with only `title`) and `move_doc` create no version. Deleting a folder deletes its subtree; Members can delete only docs they created and empty folders. Undo and the trash are in the web app and the REST API only.
- `get_doc_history` lists a doc's versions (`type: "Version"`: `version`, `title`, `changeNote`, `restoredFrom`, `linesAdded`/`linesRemoved`, `actor`, `channel`) and its other changes (`type: "Activity"`: `action` such as `doc.renamed` or `doc.moved`, with `oldValue`/`newValue`), newest first with a `cursor`. Read an old version with `get_doc` and `version`: `content` is then that version's and `atVersion` describes it, while `version` stays the latest (use it as `baseVersion`). `restore_doc_version` publishes an old version's title and content again as a new version (nothing is lost, no `baseVersion` needed); restoring what the latest version already is changes nothing, so a retry is safe.
- Diagrams: `create_diagram` with `format: "Mermaid"` (the default) and the Mermaid text as `source`. Supported types: `flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`, `mindmap`. The server does not check the syntax; a diagram that does not parse shows the parser error in the web app until it is fixed, so keep the source simple and check it before sending. A diagram's `content` (in `get_doc`, `update_doc`, `edit_doc`) is its source. Pages embed a diagram doc with `![caption](WEB-D-12)` and can also hold inline ```` ```mermaid ```` blocks. Canvas diagrams (Excalidraw JSON) are meant for drawing in the web app; prefer Mermaid when you write a diagram. To read a Canvas, use `outline` from `get_doc` (labels, then arrows such as `API → DB (SQL)`, one per line) rather than the JSON. A Canvas source you write must be `{ "type": "excalidraw", "elements": [...] }` with at most 10 000 elements, no images or `files` (`doc.diagram.embeddedFiles`) and element links only `http(s)://` or app-relative (`doc.diagram.invalidSource`); `snapshotUrl` stays null until someone opens the diagram in the web app, which renders its picture.
- PDF: `get_doc_export_link` with a `docKey` (a page, a diagram, or a folder: its whole subtree in tree order, at most 300 documents) and an optional `version` returns `{ url, expiresAt }`. `url` is relative to the server and carries a signed token, so `GET` it without the bearer token within 15 minutes (it is bound to you and that doc; afterwards, or if you lose access, it answers 404). The PDF shows only what you can read, with dates in UTC. While the server renders 2 exports and 10 wait, the `GET` answers 429 `doc.export.busy` with `Retry-After`; 503 `doc.export.unavailable` means PDF export is not set up there.
- Unpublished drafts are a web feature: MCP writes publish directly, and the publisher's own draft of that doc is discarded.
- Images and files on a page are attachments, embedded in the markdown as `![name](/api/v1/attachments/{id})`. `list_doc_attachments` lists them with their download URLs; `get_attachment_text` reads text, CSV and JSON ones, as for tickets. Uploading is web and REST only.
- Pages and diagrams have a comment thread: `list_doc_comments` (oldest first, paged), `add_doc_comment`, `update_doc_comment` (your own) and `delete_doc_comment` (your own; Owners any) with the ticket comment rules. Comments create no version. A new comment notifies the doc's author and earlier commenters (`list_notifications` items then carry `doc` instead of `ticket`). Doc comment ids and ticket comment ids are not interchangeable.
- `get_project_stats` includes `recentDocs`: the project's number of pages and diagrams and the 5 most recently updated, so "what changed in the docs lately?" needs one call.

### Docs from Claude Code

Prompts that work well with the tools above (replace the keys with yours):

- "Read the docs of project WEB and summarise how checkout works. Start with `list_docs`, then read the pages under Checkout." Claude lists the tree, reads pages with `get_doc` and follows `references` and `embeds`.
- "Write a page 'Release 1.6 notes' in WEB under Releases from the done tickets with version 1.6.0, grouped by epic, each line with the ticket key." `search_tickets` collects them, `create_folder` and `create_page` write the page; the keys become ticket chips and the page shows up under "Docs mentioning this ticket" on every ticket.
- "Add a Mermaid sequence diagram of the refund flow to WEB-D-12, as a diagram doc embedded under the heading 'Refunds'." `create_diagram` (Mermaid), then `edit_doc` inserts `![Refund flow](WEB-D-31)` below the heading without touching the rest.
- "Which docs mention PAY-42? Update them: the endpoint moved from /v1/refunds to /v2/refunds." `search_docs` with `mentions: "PAY-42"`, then one `edit_doc` per page with a find/replace edit.
- "What changed in WEB-D-12 since last week, and who changed it?" `get_doc_history`, then `get_doc` with `version` to compare.
- "Export the Runbooks folder of OPS as a PDF." `get_doc_export_link` returns a link valid for 15 minutes.

Tips: ask Claude to read before it writes (`baseVersion` comes from the read), prefer `edit_doc` for changes to long pages, and keep diagrams in Mermaid: Canvas drawings are for people in the web app.

#### Copying pages from Confluence

There is no importer (Q-09). To bring over the pages worth keeping, connect both the Atlassian MCP server and this one to Claude Code and copy them page by page, with a person checking the result:

1. **Pick the pages.** Ask Claude to list the Confluence space's page tree and mark what is still current; leave archives and meeting notes behind.
2. **Recreate the tree.** "Create the folders Architecture, Runbooks and Onboarding in project WEB" (`create_folder`). Keep titles unique per folder; that is what makes paths like `Runbooks/Restore the database` work.
3. **Copy each page.** "Read the Confluence page 'Restore the database' and create it as a page in WEB under Runbooks. Convert it to GitHub-flavoured markdown: info, note and warning panels become `> [!NOTE]`, `> [!TIP]` and `> [!WARNING]` callouts, code macros fenced code with the language, Jira issue macros the ticket key, and links to other copied pages `[Title](WEB-D-n)`. Use 'Copied from Confluence' as the change note."
4. **Diagrams.** Draw.io and Gliffy diagrams cannot be copied as drawings. Ask Claude to describe the diagram as a Mermaid flowchart or sequence diagram (`create_diagram`) and embed it; redraw anything Mermaid cannot express as a Canvas in the web app.
5. **Images and attachments** are uploaded in the web app (drag them into the editor); MCP cannot upload files.
6. **Check and link.** Read the copied page in the web app, fix what the conversion missed, and put a link to the new page at the top of the Confluence page before archiving it.

History and comments stay in Confluence; the copy starts at version 1.

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

`delete_ticket`, `delete_comment`, `unlink_tickets`, `cancel_regression_session`, `archive_board`, `delete_doc` and `delete_doc_comment` are marked destructive (`destructiveHint`) and carry `_meta["anthropic/requiresUserInteraction"]: true`. Claude Code asks you before every call of these tools, even in a session where it otherwise runs tools without asking. Keep them out of allow lists; a delegated run has no reason to call them.

## Verified with a real client

On 2026-10-27 a headless Claude Code session (`claude -p --mcp-config …`) connected to a local stack with a fresh PAT and, using only these tools, created a project, an epic with two stories in one batch, updated fields, commented, created manual and automatic test cases, ran a regression session where a failure produced a linked bug, created a board, moved a ticket into a column, searched and read the dashboard statistics — 16 calls, no errors. The integration tests also exercise every tool through an MCP client (`tests/Ticketing.IntegrationTests`).
