# Improvements triage

Everything here goes beyond the literal brief. Each item has a verdict: **IN v1** (small, and the product feels broken or untrustworthy without it) or **LATER** (moved to [../ideas.md](../ideas.md)). Sizes: S = up to 3 dev-days, M = up to 2 weeks, L = more.

The bar for IN v1 was: would a team switching off Jira hit this in its first week, and is it cheap? Expensive things that teams can live without for a month went to LATER, even when they are popular.

## IN v1

| ID | Improvement | Description | Value | Size |
| --- | --- | --- | --- | --- |
| I-01 | Assignee and reporter | `AssigneeId` (optional) and `ReporterId` (defaults to creator) on tickets. "Assign to me" action and shortcut. | Without an assignee nobody knows who owns a ticket. Every board and filter depends on it. | S |
| I-02 | Activity history with channel | Append-only log of every field change, move, comment and link per ticket, showing actor, time and channel (Web, Api, Mcp). Same table holds the admin audit trail. | Answers "who changed this and when". With LLM agents writing to tickets, the channel shows what a human did and what an agent did. | M |
| I-03 | Search and filters | Structured filters (project, type, status, priority, severity, assignee, reporter, labels, version, parent, location, dates), full-text over title and description, sorting. | The backlog alone is not enough once a project passes a few hundred tickets. | M |
| I-04 | Keyboard shortcuts and quick jump | Ctrl+K or `/` opens a palette: type a key to jump, or text to search titles. Single-key shortcuts listed in spec section 10. | "Super smooth" mostly means not reaching for the mouse. Cheap to add early, painful to retrofit. | S |
| I-05 | Ticket links | `Blocks`, `RelatesTo`, `Duplicates`, cross-project allowed, permission-filtered. | Teams link duplicates and blockers daily. Regression bugs link back to the tested story. | S |
| I-06 | Resolution on Done | `Done`, `WontDo`, `Duplicate`, `CannotReproduce`. Set automatically when entering Done. | Otherwise "closed as duplicate" and "shipped" are the same thing and the stats lie. | S |
| I-07 | Attachments | Upload, paste or drop files (10 MiB, allow-listed types) onto tickets and into markdown. Stored in PostgreSQL behind an interface. | Bug reports without screenshots are the first complaint after migration. | M |
| I-08 | My work page | Open tickets assigned to me across projects, plus my waiting regression items. | Replaces Jira's most used filter. Substitutes for notifications until they exist. | S |
| I-09 | Ticket key autolinks | `WEB-42` in any markdown renders as a link. | Descriptions and comments reference other tickets constantly. | S |
| I-10 | PAT scopes | `ReadOnly` or `ReadWrite` per token. PATs cannot manage tokens, users or flags. | Lets people give an LLM read access without write risk. Prevents a leaked token from minting new ones. | S |
| I-11 | Board archive with carry-over, multi-select moves | Archive a board and send unfinished tickets to backlogs or another board; Done tickets stay as a record. Multi-select drag between backlog and boards. | Gives the sprint flow Jira teams know without building sprints. Moving 15 tickets one by one is unacceptable. | S |
| I-12 | CSV export | Export the current search result (up to 10 000 rows). | Escape hatch for reporting in Excel, which managers will ask for in week one. | S |
| I-13 | Admin audit trail | User, role, PAT, flag and project-membership changes, viewable by Admins. | Required for an internal tool that controls access. Shares I-02's table. | S |
| I-14 | Test case preconditions and expected result | Two optional markdown fields beside the steps list. | A test step list with no expected result cannot be judged pass or fail. Bugs created from failures get a better description. | S |
| I-15 | Test case archive | Archive instead of delete once a case was used. Archived cases skip future sessions. | Features get removed. Without archiving, regressions fill with obsolete cases or history breaks. | S |
| I-16 | Regression `Skipped` and failure note | Fourth item status, required note on failure, "skip remaining" at completion. | Some cases cannot run in a given session. The failure note becomes the bug's "actual result". | S |
| I-17 | Project archive | Read-only state for finished projects; hidden from default lists. | Projects end. Deleting them loses history. | S |
| I-18 | Optimistic concurrency | `RowVersion` on aggregates, `If-Match`/`expectedVersion`, 409 on stale writes. | A human and an LLM agent editing the same ticket will otherwise overwrite each other without either noticing. | S |
| I-19 | Public REST API with OpenAPI | Documented `/api/v1`, PAT-authenticated. | Scripts and integrations (and the Jira migration script) need it; MCP needs the same use cases anyway. | S |
| I-20 | Markdown editor with preview | Write/preview tabs, toolbar for common formatting, paste-to-upload. | Markdown in a plain textarea feels unfinished next to Jira's editor. | S |
| I-21 | Shareable URLs for every view | Filters, selected ticket, board and tab are in the URL. | People paste links in chat all day. | S |
| I-22 | Operability basics | Health endpoints, structured logs, migrations on start, documented backup including attachments. | It runs on one VM. Someone has to restore it at some point. | S |
| I-23 | Dashboard version filter | One optional version filter for ticket widgets. | "How is release 1.4 looking" is the main dashboard question. | S |
| I-24 | Soft delete for tickets | Owner-only delete, keys never reused, tombstone page for deleted keys. | Accidental deletes are recoverable by an engineer; links in old chats explain what happened. | S |
| I-25 | Idempotent creates | Optional `Idempotency-Key` / `idempotencyKey` on create calls. | LLM clients retry on timeouts. Without this, retries create duplicate tickets. | S |
| I-26 | Batch ticket creation over MCP | `create_tickets` with up to 50 tickets, intra-batch parent references, all-or-nothing. | Breaking an epic into stories is the most common LLM task. One call instead of 30, and no half-created trees. | S |
| I-27 | Human keys for test cases and sessions | `WEB-TC-7`, `WEB-R-3`. | People and LLMs need short references in comments, bug descriptions and tool calls. | S |
| I-28 | MCP setup snippet on PAT creation | Shows the exact `claude mcp add` command with the new token. | Removes the main friction for the brief's stated goal. | S |
| I-29 | Board quick filters | Filter cards by assignee, project, type and label; "only my tickets" toggle. Kept in the URL. | A multi-project board with 200 cards is unreadable in standup without filters. | S |

## LATER

| ID | Improvement | Description | Value | Size |
| --- | --- | --- | --- | --- |
| I-30 | In-app notifications | Bell with events: assigned to me, mentioned, comment or status change on watched tickets. | The biggest day-one gap (see below). Deferred because it needs watchers, mentions and a delivery model to be useful; My work page covers the worst of it. First item after v1. | M |
| I-31 | Email notifications | Digest or immediate emails for the same events. | Many people live in Outlook. Needs SMTP setup on the VM. | M |
| I-32 | Watchers | Follow a ticket; reporters and assignees watch automatically. | Feeds notifications. Useless alone. | S |
| I-33 | @mentions | Autocomplete users in markdown; mention creates a notification. | Useless without notifications. | S |
| I-34 | OIDC / SSO login | Sign in through the company identity provider, JIT provisioning, offboarding via IdP. | Removes password handling and makes offboarding automatic. Owner chose local accounts for now. | M |
| I-35 | Sprints as a concept | Sprint entity with dates, goal, velocity, burndown. | Scrum teams want velocity. Board archive covers the flow; metrics wait. | L |
| I-36 | Board swimlanes | Horizontal grouping by assignee, project or epic. | Helps big boards. Quick filters cover most of it. | M |
| I-37 | Real-time board updates | Push changes to open boards and tickets (SignalR). | Nice in standups. Manual refresh and refetch-on-focus are acceptable in v1. | M |
| I-38 | Saved filters | Name and save a search, share with others. | URLs and browser bookmarks cover it in v1. | S |
| I-39 | Query language | JQL-like text queries. | Power users like it; structured filters and MCP search cover v1. | L |
| I-40 | Bulk field edit | Change status, assignee, labels or version on many tickets at once. | Useful, but MCP lets an LLM do it today, and multi-select move covers the most common case. | M |
| I-41 | Move ticket to another project | Change project, new key, redirect from the old key. | Happens, but rarely. Workaround: create anew and link. | M |
| I-42 | Clone ticket | Copy a ticket with optional children and test cases. | Convenience. | S |
| I-43 | Ticket description templates | Per-project default description per ticket type. | Helps bug report quality. | S |
| I-44 | Custom fields | Project-defined extra fields. | The brief's whole point is to avoid Jira's field sprawl. Probably never. | L |
| I-45 | Configurable workflows | Allowed transitions and rules per project. | Same as above. Free transitions are a deliberate choice. | L |
| I-46 | Due dates | Optional date with overdue highlight. | Some teams use them; not in the brief. | S |
| I-47 | Time tracking | Estimates and logged time. | Not used by the owner's teams per the brief's motivation. Probably never. | M |
| I-48 | Jira importer | Built-in import of projects, tickets, comments, attachments from Jira. | One-off need. A script against the REST API (or Claude Code over MCP) handles it (D-11). | L |
| I-49 | Webhooks | Outgoing events on ticket changes. | Integrations. | M |
| I-50 | Git integration | Link commits, branches and pull requests by ticket key. | Strong for developers, and LLM agents already put keys in commits. | M |
| I-51 | CI results for automatic test cases | API for CI to report pass/fail per `AutomationReference` into a session. | Makes "Automatic = Passed" true instead of assumed (D-13). | M |
| I-52 | Multi-variant A/B tests | Flag variants with weights, exposure events, result comparison. | v1 has the contract and view registry; this adds the experiment itself. | M |
| I-53 | Releases | Version entity with dates, status and release notes generated from Done tickets. | Natural next step after version hints. | M |
| I-54 | Test case linked to many tickets | Many-to-many test case to ticket. | One case often covers several stories. One link is enough for v1. | M |
| I-55 | Add cases to a running session | Pull newly added test cases into an in-progress session. | Avoids restarting a session after a late test case. | S |
| I-56 | Restore deleted tickets | Admin UI to undo soft deletes. | Rare; an engineer can do it in SQL meanwhile. | S |
| I-57 | User anonymization | Replace name and email of a deactivated user with a placeholder. | GDPR erasure requests. | S |
| I-58 | Dark mode | Second theme. | Popular with developers. Build with design tokens from day one so it stays cheap. | S |
| I-59 | Mobile layout | Usable on phones. | Desktop-first internal tool. | M |
| I-60 | Internationalization | Polish and other languages. | Brief says English only for now. Keep strings in one place. | M |
| I-61 | Charts: burndown, cumulative flow, cycle time | Flow metrics from status history. | Activity history already stores the data. | M |
| I-62 | Board column options | Hide columns, WIP limits per column. | Eight columns are wide; some teams never use OnHold. | S |
| I-63 | Private boards | Boards visible only to chosen users. | Board names can hint at private work. Low risk internally. | S |
| I-64 | Project key rename | Change key with redirects from old keys. | Rare and risky. | M |
| I-65 | Search in comments | Include comment text in full-text search. | Useful but doubles index size and ranking work. | S |
| I-66 | Attachment upload over MCP | Let agents attach logs and screenshots. | Nice for agent-driven bug reports. | S |
| I-67 | Teams or Slack integration | Unfurl ticket links, post events to channels. | Depends on the company chat tool. | M |
| I-68 | Comment reactions | Emoji reactions. | Low value. | S |
| I-69 | Read-only public projects | Per-project option: public means read-only for non-members. | Owner chose full write for public projects; some projects may want visibility without edits. | S |
| I-70 | Self-service password reset | "Forgot password" via email link. | Needs email (I-31). Admin-issued links cover v1. | S |
| I-71 | Cross-project dashboards | Portfolio view over several projects or a board. | Managers will ask. Per-project and CSV cover v1. | M |
| I-72 | Partial regression sessions | Start a session from a subset (by label, linked ticket or selection). | Smoke tests vs full regression. | M |
| I-73 | Test case labels or folders | Organise large test suites. | Needed past a few hundred cases. | S |
| I-74 | MCP prompts and resources | Canned prompts (for example "triage this bug") and resources. | Tools cover the job; prompts are polish. | S |
| I-75 | Stale ticket housekeeping | Bulk close or flag tickets untouched for N days. | Backlogs rot. Dashboard widget shows the problem first. | S |

## Day-one check: what a team leaving Jira will miss

I went through a typical Jira week (standup, refinement, bug triage, release, regression) and checked what breaks.

| Need | Covered in v1 by | Gap that remains |
| --- | --- | --- |
| Who works on what | I-01, I-08, I-29 | None. |
| Getting told about changes | I-08 My work page | No notifications. People must check My work. Highest-priority LATER (I-30). Product owner should confirm this is acceptable (Q-02 in decisions). |
| Screenshots on bugs | I-07 | None. |
| Sprint planning and carry-over | Boards + I-11 | No velocity or burndown (I-35, I-61). |
| Finding old tickets | I-03, I-04 | No comment search, no saved filters. |
| Linking duplicates and blockers | I-05, I-06 | None. |
| Exporting for a status report | I-12, dashboard | No cross-project dashboard. |
| Existing Jira data | REST API + migration script | No built-in importer. Q-01 in decisions. |
| Sign-in | Local accounts | Separate password from the company account until OIDC (I-34). |
| Release notes | Version field + search by version + CSV | No release entity. |
| Bulk changes | Multi-select move, MCP | No bulk field edit in the UI. |
