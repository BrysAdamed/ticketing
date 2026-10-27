# Ideas backlog (after v1)

Items triaged as LATER in [product/02-improvements-triage.md](product/02-improvements-triage.md). IDs match that file. Sizes: S = up to 3 dev-days, M = up to 2 weeks, L = more. Within each theme, items are in suggested order.

This file is the pool of unscheduled ideas. Once an idea is scheduled it becomes a ticket in the Ticketing instance itself (project `TKT`) and its row here links to that ticket.

## Shipped in v1 after all

| ID | Idea | Where it landed |
| --- | --- | --- |
| I-58 | Dark mode | Light and dark themes from the design tokens, OS default plus toggle. |
| I-36 | Board swimlanes | By assignee, epic, project and priority. |
| I-40 (part) | Bulk field edit | Backlog bulk bar sets status, priority, assignee and type, and moves to a board; labels and version remain (see I-40 below). |
| I-56 (part) | Restore deleted tickets | Delete has a 10-minute Undo (D-82); a "recently deleted" list remains (see I-56 below). |

## Notifications and collaboration

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-30 | In-app notifications (TKT-7, D-94) | Biggest gap for teams coming from Jira. First thing to build after v1. | M |
| I-32 | Watchers (TKT-6, D-93) | Feeds notifications; reporter and assignee watch automatically. | S |
| I-33 | @mentions in markdown (TKT-8, D-96) | Only useful once notifications exist. | S |
| I-31 | Email notifications | Reaches people who live in Outlook. Needs SMTP from the VM. | M |
| I-37 | Real-time board and ticket updates | Boards in standups stay current without refresh. | M |
| I-67 | Teams or Slack integration | Link unfurling and channel posts. Pick after confirming the company chat tool. | M |
| I-68 | Comment reactions | Lightweight acknowledgement. Low value. | S |
| – | Notification preferences: mute a kind or a project (TKT-7 notifies on every trigger in D-94) | Busy watchers may want only assignments and mentions. | S |

## Identity and access

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-34 | OIDC / SSO login with JIT provisioning | No passwords to manage; offboarding follows the company IdP. Owner deferred it (D-01). Keep the auth layer pluggable. | M |
| I-70 | Self-service password reset by email | Removes Admin from the reset loop. Needs email. | S |
| I-69 | Read-only option for public projects | Some projects want visibility without outside edits. | S |
| I-63 | Private boards | Board names can reveal private work. | S |
| I-57 | User anonymization | GDPR erasure for former employees. | S |
| I-78 | Active sessions list and "sign out everywhere" | Lets users end a session on a lost laptop. The security stamp (D-55) already does the work. | S |
| I-79 | Breached-password check (HIBP k-anonymity range API) | Catches leaked passwords beyond the bundled list (D-54). Needs outbound internet from the VM. | S |
| – | "Leave project" for non-owners | Today only Owners remove members; a member who no longer needs a private project asks an Owner. | S |
| – | Remember board links on project archive and offer to relink on unarchive | Unarchive restores the project but not its board links (D-52). | S |
| – | Project favourites and recently viewed in the sidebar | The design's sidebar orders projects by favourites, then recent. v1 lists projects by key. | S |

## Planning and boards

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-62 | Board column options (hide columns, WIP limits) | Eight columns are wide and some teams skip statuses. | S |
| I-35 | Sprints with dates, goal, velocity and burndown | Scrum metrics. Board archive covers the flow until then. | L |
| I-53 | Releases with release notes | Turns the free-text version into a managed release. | M |
| I-75 | Stale ticket housekeeping | Bulk close or flag long-untouched tickets. | S |
| – | Readable board URLs | `/boards/{guid}` is hard to read and share by voice; a short board key or slug (`/boards/web-sprint-42`) with the id as fallback (UX review UX-38). Needs a unique, renamable slug and redirects from old slugs. | S |

## Tickets and search

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-38 | Saved and shared filters | Named searches beyond bookmarks. | S |
| I-65 | Search in comments | Finds discussions, not just descriptions. | S |
| I-106 | Sub-tickets graph: server-side view preference, grandchildren as collapsible groups, story-point-weighted critical path, "ready" filter in the backlog | Follow-ups to the graph view (D-95); v1 keeps the choice per browser and counts tickets, not points. | M |
| - | Relevance sort for text search | `ts_rank` ordering needs a cursor on a float; v1 sorts by updated. | S |
| - | Custom date ranges in the search UI | v1 offers presets; any range works through the URL. | S |
| - | Server-side image thumbnails | The attachments list scales full images down in the browser. | S |
| I-42 | Clone ticket | Convenience for repeated work. | S |
| I-43 | Description templates per ticket type | Better bug reports. | S |
| I-46 | Due dates | Some teams track deadlines. | S |
| I-56 | Restore deleted tickets from the UI | Undo for Owner mistakes. The 10-minute Undo exists (D-82); this is a "recently deleted" list for older deletions. | S |
| I-40 | Bulk edit of labels and version | The backlog bulk bar already sets status, priority, assignee and type; labels and version are still per ticket. | S |
| I-41 | Move ticket to another project | New key plus redirect from the old one. | M |
| I-64 | Project key rename with redirects | Rare, risky, but asked for eventually. | M |
| I-39 | Query language | Power-user search. | L |
| I-76 | Bulk update endpoint (`PATCH /tickets` for many keys, all or nothing) | The backlog bulk bar sends one PATCH per ticket today; one call would make partial failures impossible. | S |
| I-77 | Backlog paging past 10 000 tickets | The backlog is one unpaged response capped at 10 000 rows (D-47). Only needed if a project's open backlog grows past that. | M |

## Testing and regressions

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-55 | Add new test cases to a running session | Avoids restarting a session for one late case. | S |
| I-73 | Test case labels or folders | Organise suites past a few hundred cases. | S |
| I-51 | CI reports results for automatic test cases | Replaces the assumed auto-pass with real results. | M |
| I-54 | Test case linked to many tickets | One case often covers several stories. | M |
| I-72 | Partial regression sessions | Smoke runs from a subset of cases. | M |

## Reporting

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-61 | Burndown, cumulative flow, cycle time | Activity history already holds the data. | M |
| I-71 | Cross-project dashboards | Portfolio view for managers. | M |
| I-80 | Dashboard deltas and period selector | KPI tiles with "vs previous period" deltas and sparklines, and a 30/90-day range for created vs resolved (layout-and-screens §3.5 sketches them; spec §7 does not define them). | S |
| I-81 | Version filter for regression widgets | Sessions have a version too, so "how did 1.4 regress" could filter the regression summary like the ticket widgets (spec §7 limits the filter to tickets). | S |

## Integrations and LLM

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-66 | Attachment upload over MCP | Agents can attach logs and screenshots to bugs. | S |
| I-74 | MCP prompts and resources | Canned workflows such as "triage this bug". | S |
| I-49 | Outgoing webhooks | Lets other tools react to ticket changes. | M |
| I-50 | Git integration by ticket key | Shows commits and pull requests on the ticket. | M |
| I-48 | Built-in Jira importer | Not planned: the PO decided against migrating Jira data (Q-01). Revisit only if that changes. | L |
| I-124 | Our own agent helper app: auto-start, background (headless) runs, enforced launch options (permission mode, model) and run reporting | v1 launches through Claude's deep link, which can carry only a folder and a prompt (D-98); the launch options of the helper design were dropped with it. | L |
| - | Richer agent prompt templates: `else`, nesting, a sanitised `ticket.title` | v1 keeps a flat `if` and trusted placeholders only (D-98); per-type templates already remove most branching. | S |
| - | Match host-specific URL shapes of one repository | The normalized repository URL compares host and path (D-99), so Azure DevOps' `ssh.dev.azure.com:v3/org/project/repo` and `dev.azure.com/org/project/_git/repo` do not match. A per-host rewrite table would let such clones pass the agent's remote check. | S |
| - | Admin status line for a missing `TICKETING_PUBLIC_URL` | While it is unset every agent endpoint, the Admin prompt pages included, is `agent.disabled` (D-99), so an Admin with the flag on only learns why from the error message. A small always-available status endpoint would let the Admin page say so. | S |
| - | Evaluate the default agent prompts | The built-ins (D-102) are hypotheses. The prompt designer's evaluation plan (04-delegate-to-agent-prompts.md §6: a sandbox stack, 2–3 historical tickets per type, injection probes, a rubric with safety as a gate, and field data from the `Delegated run` marker) would show which wording works before the next release. | M |
| - | Deny rules for delegated runs | The prompt designer wanted `--disallowedTools` for tracker writes a delegated run never needs and for force-pushes (§2.2). A deep link cannot pass flags, so v1 relies on the guardrails and on `requiresUserInteraction` for destructive tools (D-102); our own helper (I-124) or a shipped `.claude/settings.json` snippet could add them. | S |
| - | Editable merge-policy sentences | The two `{{finish}}` sentences ship fixed with the built-ins (D-98); an Admin may want to word them for the company's forge and review flow. | S |

## Experiments and UI

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-52 | Multi-variant A/B tests with exposure tracking | Builds on the v1 flag contract and view registry. | M |
| I-59 | Mobile layout | Checking tickets on the go. | M |
| I-60 | Internationalization (Polish first) | Brief says English for now. | M |

## Probably never

| ID | Idea | Why not |
| --- | --- | --- |
| I-44 | Custom fields | Recreates the Jira sprawl this project exists to escape. |
| I-45 | Configurable workflows | Same. Free status transitions are deliberate. |
| I-47 | Time tracking | Not used by the teams per the brief. |
