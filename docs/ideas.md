# Ideas backlog (after v1)

Items triaged as LATER in [product/02-improvements-triage.md](product/02-improvements-triage.md). IDs match that file. Sizes: S = up to 3 dev-days, M = up to 2 weeks, L = more. Within each theme, items are in suggested order.

## Notifications and collaboration

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-30 | In-app notifications (assigned, mentioned, watched-ticket changes) | Biggest gap for teams coming from Jira. First thing to build after v1. | M |
| I-32 | Watchers | Feeds notifications; reporter and assignee watch automatically. | S |
| I-33 | @mentions in markdown | Only useful once notifications exist. | S |
| I-31 | Email notifications | Reaches people who live in Outlook. Needs SMTP from the VM. | M |
| I-37 | Real-time board and ticket updates | Boards in standups stay current without refresh. | M |
| I-67 | Teams or Slack integration | Link unfurling and channel posts. Pick after confirming the company chat tool. | M |
| I-68 | Comment reactions | Lightweight acknowledgement. Low value. | S |

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
| I-36 | Board swimlanes by assignee, project or epic | Large multi-project boards. | M |
| I-35 | Sprints with dates, goal, velocity and burndown | Scrum metrics. Board archive covers the flow until then. | L |
| I-53 | Releases with release notes | Turns the free-text version into a managed release. | M |
| I-75 | Stale ticket housekeeping | Bulk close or flag long-untouched tickets. | S |

## Tickets and search

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-38 | Saved and shared filters | Named searches beyond bookmarks. | S |
| I-65 | Search in comments | Finds discussions, not just descriptions. | S |
| I-42 | Clone ticket | Convenience for repeated work. | S |
| I-43 | Description templates per ticket type | Better bug reports. | S |
| I-46 | Due dates | Some teams track deadlines. | S |
| I-56 | Restore deleted tickets from the UI | Undo for Owner mistakes. | S |
| I-40 | Bulk field edit in the UI | Change many tickets at once without MCP. | M |
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

## Integrations and LLM

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-66 | Attachment upload over MCP | Agents can attach logs and screenshots to bugs. | S |
| I-74 | MCP prompts and resources | Canned workflows such as "triage this bug". | S |
| I-49 | Outgoing webhooks | Lets other tools react to ticket changes. | M |
| I-50 | Git integration by ticket key | Shows commits and pull requests on the ticket. | M |
| I-48 | Built-in Jira importer | Only if the one-off migration script proves insufficient (D-11). | L |

## Experiments and UI

| ID | Idea | Why | Size |
| --- | --- | --- | --- |
| I-58 | Dark mode | Cheap if the UI uses design tokens from day one. | S |
| I-52 | Multi-variant A/B tests with exposure tracking | Builds on the v1 flag contract and view registry. | M |
| I-59 | Mobile layout | Checking tickets on the go. | M |
| I-60 | Internationalization (Polish first) | Brief says English for now. | M |

## Probably never

| ID | Idea | Why not |
| --- | --- | --- |
| I-44 | Custom fields | Recreates the Jira sprawl this project exists to escape. |
| I-45 | Configurable workflows | Same. Free status transitions are deliberate. |
| I-47 | Time tracking | Not used by the teams per the brief. |
