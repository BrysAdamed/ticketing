# Decision log

Open questions found in the [original brief](product/00-original-brief.md) and while writing the [v1 spec](product/01-refined-spec.md). "Decided" entries are settled; the spec follows them. "Needs product owner" entries carry a recommended answer, and the spec currently assumes that answer.

Format: question, options considered, decision, rationale. "PO" marks decisions made by the product owner.

## Decided

### D-01 Authentication (PO)

- Question: local accounts or SSO/OIDC?
- Options: local email + password accounts; OIDC against the company identity provider; both.
- Decision: local accounts in v1. Admins create users (email + password, set through a one-time link). PATs for API and MCP. OIDC/SSO is LATER (I-34).
- Rationale: matches the brief's "users management (CRUD)", no dependency on another team's IdP for launch. Keep authentication behind ASP.NET Core's scheme abstraction so adding OIDC does not touch business code.

### D-02 Public project write access (PO)

- Question: what can a signed-in non-member do on a public project?
- Options: read only; read + comment; full write.
- Decision: full write. Any signed-in user can create and edit tickets, comment, manage test cases and run regressions on a public project. Project settings, membership and deleting the project stay with Owners and Admins. Private projects are members only.
- Analyst additions (see Q-05): deleting tickets, deleting other people's comments, assigning regression items to others and hard-deleting test cases also stay with Owners. They are destructive or moderation actions, not create/edit.
- Rationale: PO decision. It matches how internal teams share work.

### D-03 Hosting (PO)

- Question: where does it run?
- Decision: Docker Compose on an internal VM (`api`, `web`, `db`).
- Rationale: PO decision. Consequences: single PostgreSQL instance, no cloud blob storage assumed (D-15), backups via `pg_dump`.

### D-04 Scale assumption

- Question: brief gives no numbers. What do performance targets assume?
- Decision: up to 500 users, 200 projects, 200 000 tickets, 50 000 tickets in one project, 500 cards on a board.
- Rationale: generous for an internal company tracker. Fits one PostgreSQL instance with plain indexes; no caching layer or search engine needed.

### D-05 Status transitions

- Options: free (any to any); fixed workflow; configurable workflow.
- Decision: free. Side effects only (resolution, resolved date).
- Rationale: workflows are one of the Jira features the owner wants to escape. Constraints can come later per project if a team proves the need.

### D-06 Parent and child across projects

- Options: same project only; any project.
- Decision: same project only. Epics have no parent. Max depth 3. Cycles rejected.
- Rationale: cross-project parents mix permissions (a public child under a private epic) and complicate statistics. Cross-project relations use links.

### D-07 Board visibility

- Options: boards have their own members; boards visible to everyone with cards filtered by project access.
- Decision: every signed-in user sees every board; cards appear only if the viewer can read the ticket's project.
- Rationale: one permission model (project access) instead of two. Private boards are LATER (I-63).

### D-08 Roles model

- Options: fixed roles; custom roles with permission sets.
- Decision: fixed enums. Global: Admin, User. Project: Owner, Member, Viewer. No Role table.
- Rationale: covers the brief. Custom roles are Jira-style complexity.

### D-09 Sprints

- Options: build sprints; treat boards as the sprint container.
- Decision: no sprint entity. Boards plus "archive with carry-over" (I-11) give the pull-work, finish, carry-over flow.
- Rationale: the brief says a ticket is in a backlog or on a board, which already describes sprint planning. Velocity and burndown are LATER (I-35).

### D-10 Project key

- Decision: regex `^[A-Z][A-Z0-9]{1,9}$`, unique forever, immutable.
- Rationale: keys appear in commits, chats and LLM context. Renaming breaks all of them. Rename with redirects is LATER (I-64).

### D-11 Jira data migration mechanism

- Options: built-in importer; one-off script against the REST API (or Claude Code over MCP).
- Decision: no importer and no migration (superseded by the PO answer to Q-01 below: teams start fresh).
- Rationale: an importer is L-sized and used once.

### D-12 User deletion

- Options: hard delete; soft delete; deactivate only.
- Decision: deactivate only. History keeps the name with "(deactivated)". Anonymization is LATER (I-57).
- Rationale: tickets, comments and history must keep their authors.

### D-13 Automatic test cases in regressions

- Question: the brief says automatic cases are marked as passed. Passed based on what?
- Decision: they are marked `Passed` at session start, labelled "auto-passed", with no executor. Anyone can still change an auto-passed item to `Failed`.
- Rationale: follows the brief. The honest version (CI reports results) is LATER (I-51); the `AutomationReference` field prepares it.

### D-14 A/B testing readiness

- Question: brief asks views to support A/B tests later but no multiple views now.
- Decision: flags evaluate to a variant string (`on`/`off` in v1); every page resolves through a view registry keyed by view id with one `default` variant. No second variants built.
- Rationale: the contract and the indirection are cheap now and expensive to retrofit.

### D-15 Attachment storage

- Options: PostgreSQL `bytea`; Docker volume on the VM; blob storage.
- Decision: PostgreSQL behind `IAttachmentStore`, 10 MiB per file, 50 per ticket.
- Rationale: one backup covers everything on a single VM. The interface allows moving to a volume or blob store if the database grows past comfortable backup size.

### D-16 Viewer role on public projects

- Decision: has no effect while the project is public (everyone has Member access). It applies again if the project becomes private.
- Rationale: follows from D-02 without special cases.

### D-17 Admins and private projects

- Decision: Admins have Owner access to every project, private included. Access is not separately logged in v1.
- Rationale: someone must be able to fix orphaned projects. See Q-04.

### D-18 Who can create projects and boards

- Decision: any active user (brief: "each user should be able to create project").

### D-19 Test case ownership

- Options: test case belongs to a ticket; to a project with an optional ticket; many-to-many.
- Decision: belongs to a project; optional link to one ticket in the same project.
- Rationale: the brief wants both "ticket has test cases" and "all test cases of the project". Tickets end; regression suites outlive them. Many-to-many is LATER (I-54).

### D-20 Regression snapshot

- Decision: session start copies title, preconditions, steps, expected result, automation reference and mode into each item. Later test case edits never change sessions.
- Rationale: history must show what was actually tested.

### D-21 Which test cases join a session

- Decision: non-archived `Manual` and `Automatic` cases. `New` cases are excluded.
- Rationale: `New` means not ready. Including them would fill sessions with unexecutable items.

### D-22 Parallel sessions

- Decision: a project may have several `InProgress` sessions.
- Rationale: two release branches tested at once is normal. A uniqueness rule adds friction for no safety.

### D-23 Who records regression results

- Decision: any writer can take an item, including from another assignee (UI confirms). Only the assignee records a result; recording on an unassigned item assigns the actor. Owners can assign to others.
- Rationale: follows the brief ("each user can assign a given case to them"), and avoids items stuck on someone on holiday.

### D-24 Bug from a failed regression item

- Decision: one bug per item, created on demand from a pre-filled dialog (UI) or `createBug` flag (API/MCP). Bug goes to the top of the backlog with Severity Major, Priority High, session version, label `regression`, templated description and a `RelatesTo` link to the test case's ticket.
- Rationale: the brief's "automatically create a bug" works best as one click with a reviewable draft; fully automatic creation produces junk bugs for flaky cases.

### D-25 Session completion

- Decision: complete only when nothing is waiting; "skip remaining" bulk action. Completed sessions are immutable. Owners or the starter can cancel.

### D-26 Severity and priority

- Decision: Priority required (Highest..Lowest, default Medium) on all tickets. Severity optional (Blocker..Trivial) on all tickets, shown prominently for bugs.
- Rationale: the brief lists both for every ticket; forcing severity on a user story is noise.

### D-27 Story points

- Decision: integer 0..100, optional, no enforced scale. UI suggests Fibonacci values.

### D-28 Version and labels

- Decision: version is free text (50 chars, case-sensitive). Labels are lower-cased, no spaces, max 20 per ticket. Hints return distinct project values by recent use.
- Rationale: brief says free text with hints. Lower-casing labels stops "Backend" and "backend" splitting statistics.

### D-29 Board columns

- Question: the brief says boards show "swimlines with the statuses".
- Decision: read as one column per status, all 8, fixed order. Horizontal swimlanes are LATER (I-36).

### D-30 Placement and ordering

- Decision: one `Rank` per ticket (fractional index) ordered within its container. New tickets go to the bottom of the backlog; tickets returned from a board go to the top. A Done ticket on an archived board that is reopened moves to the backlog top.

### D-31 Hidden cards on shared boards

- Options: show a "N hidden" indicator; omit silently.
- Decision: omit silently, counts computed per viewer.
- Rationale: an indicator leaks that private work exists. Simple rule, simple tests.

### D-32 Default project visibility

- Decision: `Private`. Making work visible should be a choice, especially since public means full write (D-02).

### D-33 Ticket deletion

- Decision: Owners only, soft delete, rejected while the ticket has children, keys never reused.

### D-34 Comments

- Decision: markdown, author edits or deletes own at any time; Owners delete any; deleted comments leave a placeholder; edits are kept in history.

### D-35 Concurrency

- Decision: optimistic, per aggregate, opt-in expected version; the web UI always sends it.
- Rationale: humans and LLM agents will edit the same tickets.

### D-36 MCP transport

- Options: local stdio server wrapping REST; HTTP endpoint in the API.
- Decision: Streamable HTTP at `/mcp` in the API process, authenticated with PATs.
- Rationale: nothing to install for users, one deployment, same application layer as REST.

### D-37 PAT rules

- Decision: mandatory expiry (max 365 days), `ReadOnly` or `ReadWrite` scope, SHA-256 hashed, shown once, cannot manage tokens, users or flags.
- Rationale: tokens end up in LLM config files; they must be limited and expire.

### D-38 Password and session policy

- Decision: no email in v1; Admin-issued set-password links (72 h new user, 24 h reset). 12+ character passwords, common-password check, 5-attempt lockout for 15 minutes (per client address, D-74).
- Rationale: follows NIST 800-63B guidance without SMTP on the VM.

### D-39 Search technology

- Decision: PostgreSQL full text plus trigram index. No Elasticsearch or similar.
- Rationale: enough at D-04 scale; one less container.

### D-40 Language and devices

- Decision: English only, desktop first (min 1280 px), latest Chrome, Edge, Firefox.
- Rationale: brief says English for now; internal desktop users.

### D-41 Last owner and last admin

- Decision: the last active Admin cannot be demoted or deactivated. Deactivating the last Owner of a non-archived project is blocked until another Owner is added.

### D-42 Where per-project counters live

- Question: the spec put `NextTicketNumber` etc. on the project row, so every ticket creation changes the project's row version and the settings form gets spurious 409s.
- Decision: counters live in a separate `project_counters` table (`project_id`, `kind`, `next_value`), allocated with `UPDATE … RETURNING`.
- Rationale: keeps hot writes off the project aggregate; same race-free guarantee.

### D-43 Which edits use optimistic concurrency

- Question: comments, links and attachments bump `Ticket.UpdatedAt` (and so its row version). Mandatory `If-Match` would make inline edits fail after any comment.
- Decision: `If-Match` is optional everywhere. The web UI sends it only when saving title and description (long text, where a lost update hurts). Inline single-field edits (status, priority, assignee, labels…) are last-writer-wins and recorded in history.
- Rationale: smooth UI with protection where it matters; history shows every overwrite.

### D-44 Board operations and ticket write access

- Question: archiving a board, unlinking a project or deleting a board moves tickets, possibly from projects the board owner cannot write to.
- Decision: allowed. These operations only change placement (back to backlog or to another board), never content. An activity entry is written per ticket with the actor.
- Rationale: otherwise a board could become impossible to archive.

### D-45 UI component library

- Decision: Angular Material 22 + CDK, themed with our tokens (PO decision). PrimeNG 22 switched to a commercial license that Adamed would have to buy.
- See [ADR 0009](adr/0009-frontend-stack.md).

### D-46 Spec vs research discrepancies

- Decision: where the research scratch code differs from the spec (cookie `SameSite`, PAT format and mandatory expiry, `english` text search configuration, `/api/v1/me/flags` contract, health and OpenAPI paths, markdown raw HTML), the spec wins. Feature-flag bucketing hashes the user id as a lower-case GUID string ("D" format).

### D-47 Backlog is one unpaged response

- Question: §2 says lists are cursor-paged (max 100), but the backlog UI groups by status, virtual-scrolls and drags across the whole list.
- Decision: `GET /projects/{key}/backlog` returns every matching backlog ticket in rank order in one lean response: one row per ticket with ids instead of nested users or parents, which are listed once in `users` and `parents`. The response is capped at 10 000 rows and sets `truncated` when it was cut. Done tickets are excluded unless `showDone` (or a status filter) asks for them.
- Rationale: 5 000 open tickets load in one indexed query (about 0.5 MB before gzip). Paging would make grouping, drag between pages and multi-select far more complex for no gain at D-04 scale.

### D-48 Backlog reorder moves a block

- Decision: a backlog reorder takes 1..100 tickets in the order they should end up in, plus one anchor: `beforeKey`, `afterKey` or `position` (`Top`/`Bottom`). It is served by `POST /tickets/move` with target `backlog` since D-77 (it started as `POST /projects/{key}/backlog/rank`). The ranker reads the anchor's neighbours under the container lock and generates all keys at once. When a key would grow too long, it rebalances with free slots (`ITicketRanker.PlaceManyAsync`). Reordering writes no history (rank is never shown) and does not bump `UpdatedAt`.
- Rationale: one call covers single and multi-select drag and is race-free. The same primitive serves board moves (`move_ticket`).

### D-49 Link history and visibility

- Decision: adding or removing a link writes `ticket.link.added` or `ticket.link.removed` on the ticket the actor edited (the route's ticket) and bumps only its `UpdatedAt`. History entries and links whose other ticket the reader cannot read are left out. A deleted ticket answers 404 with code `ticket.deleted` and the message "WEB-42 was deleted by X on date".
- Rationale: writing on both sides would put a private ticket's key into a public ticket's history.

### D-50 Ticket client services live in core

- Question: the backlog, boards, test cases and regressions all read and create tickets, but features may not import each other.
- Decision: the ticket wire types and client services live in `web/src/app/core/tickets` (`TicketsApi`, `TicketCache`, `TicketEvents`, `TicketCreator`, `TICKET_DETAIL_SECTIONS`). The create dialog component stays in `features/tickets` and is wired lazily through `provideTicketCreation` in `app.config.ts`. Other features add ticket view sections through `provideTicketDetailSection`. Edits made in one view reach the others through `TicketEvents`, with no refetch.
- Rationale: one ticket model and one event bus instead of per-feature copies. The ticket view stays closed to edits from other slices but open to their sections.

### D-52 Project archive order and orphaned unarchive

- Question: archiving a project sends tickets from several boards to one backlog, so whose order wins? And how does an archived project get an Owner again if every Owner was deactivated while it was archived? Membership changes are blocked while it is archived.
- Decision: the returned tickets go to the backlog top as one block, ordered board by board (oldest board first) and by board rank within each board. Tickets already in the backlog keep their order below that block. On unarchive, if no active Owner member remains, the acting Admin becomes an Owner (an existing membership is promoted). This is recorded as `project.member.ownerRestored`.
- Rationale: the order is deterministic and keeps each board's priorities together. The automatic owner keeps the invariant "a non-archived project has an active Owner" without a special admin flow. Only an Admin can be in that position, because a non-admin Owner is always an active Owner member.

### D-53 Project deletion transport

- Decision: `DELETE /api/v1/projects/{key}?confirmKey={key}` is limited to Admins on a cookie session (`auth.cookieSessionRequired` for PATs) and has no MCP tool. A wrong key gives 400 `project.delete.notConfirmed`. A project that is not archived gives 409 `project.notArchived`.
- Rationale: spec 9.3 keeps project deletion in the web UI. A query parameter avoids a body on DELETE.

### D-54 Which common passwords are checked

- Question: the spec asks for "the 10 000 most common passwords", but only 10 of SecLists' generic top 10 000 are 12 characters or longer, so with the length rule the check would block almost nothing.
- Decision: bundle the 10 000 most frequent passwords of 12 to 128 printable ASCII characters from SecLists' `xato-net-10-million-passwords-1000000.txt` (MIT), lower-cased, as an embedded resource. Comparison is case-insensitive.
- Rationale: it keeps the spec's size and intent (NIST 800-63B blocklist) and actually rejects things like `qwerty123456` or `1qaz2wsx3edc`.

### D-55 Ending sessions on password changes

- Question: how do other cookie sessions end when a password changes (spec 6.14)?
- Decision: each user has a `SecurityStamp` that rotates whenever a password is set (set-password link or change of own password). The session cookie carries the stamp, and the per-request revalidation rejects a session whose stamp no longer matches. Changing your own password re-issues the current session, so only the other sessions end. Hash upgrades on login keep the stamp. PATs are not affected by password changes; they are revoked explicitly or by deactivation.
- Rationale: one extra column, checked by the lookup that already runs on every cookie request. It also prepares "sign out everywhere" (I-78).

### D-56 Set-password links

- Decision: the token is 256 random bits (base64url), stored as SHA-256. The API returns `{ token, path, expiresAt }`; the SPA builds the absolute URL from its own origin. `POST /auth/set-password/inspect` and `POST /auth/set-password` are anonymous and share the login rate limit; the token travels in the body, never in an API URL. Unknown, used, expired and deactivated users' links all answer 404 `user.setPasswordToken.invalid`. Using a link also lifts a lockout. Deactivation clears a pending link.
- Rationale: no oracle for which links exist; the API does not need to know its public origin behind nginx.

### D-57 No Idempotency-Key on creates that return a secret

- Decision: `POST /admin/users` (returns a set-password link) and `POST /me/tokens` (returns the PAT) do not accept `Idempotency-Key`.
- Rationale: replaying would mean storing the secret in `idempotency_records`. A retried user create fails cleanly with `user.emailTaken`; a retried PAT create fails with `pat.name.taken`.

### D-58 Who counts as another project owner, and user search

- Decision: for `user.lastProjectOwner`, another Owner must be an active member with the `Owner` role; an Admin's implicit Owner access does not count. The error lists the project keys in `errors.projects`. User search (`GET /users`, MCP `find_users`) matches an email prefix or the start of any word of the display name, returns at most 20, and hides deactivated users on REST unless `includeInactive=true`. MCP `find_users` without `projectKey` includes them (with `isActive`), so an LLM can resolve names on old tickets. With a project, only active users who can write there are returned.
- Rationale: an implicit Admin owner would let a project become ownerless as soon as the Admin is demoted.

### D-59 How the dashboard is computed

- Question: spec §7 asks for every widget in under 500 ms for a 50 000-ticket project without precomputed tables.
- Decision: one handler (`GetProjectDashboard`) runs eight SQL aggregates in sequence on one connection: a single `GROUP BY status, type, priority, severity, unassigned, stale` scan feeds widgets 1 to 5 and the stale count, then weekly created/resolved, top assignees, the 10 oldest stale tickets, epics (top 50 picked through a new `(project_id, type)` index, children aggregated per epic through the parent index), test cases, sessions and regression bugs. Queries do not run in parallel on separate connections. The perf test (`DashboardPerformanceTests`, 2 × 50 000 tickets) measures p95 ≈ 55 ms for the whole endpoint; parallelism would save at most ~20 ms at the cost of extra pooled connections per request.
- Rationale: few, index-friendly scans keep the endpoint far below the budget; domain rules (what "open" means) stay in C# over the small grouped result.

### D-60 Dashboard scope rules

- Decision: the version filter (I-23) is an exact, case-sensitive match on the ticket version and applies to widgets 1 to 9 and 12. With a filter, an epic is listed when it or one of its direct children has that version, and its progress counts only the children with that version. Test cases and regressions ignore the filter. The regression summary skips cancelled sessions; "regression bugs" counts open bugs from items of any session, cancelled ones included, because the bug is still real work. Epic progress lists at most 50 open epics (priority, then key) and reports the total, so a huge project cannot bloat the response. Week buckets are ISO weeks in UTC; the current, partial week is the last bucket.
- Rationale: matches "how is release 1.4 looking" without making the regression history disappear, and keeps every number reproducible by a search link (docs/architecture/search-url-format.md).

### D-61 Dashboard visual forms

- Decision: the four totals are stat tiles; status is a 100% category bar over a per-status bar list; type, priority, severity and assignee are compact bar lists (glyph, label, bar, linked count); created vs resolved is a two-line Chart.js chart with a table view; epic progress uses two meters per epic; regression pass rates are a five-point sparkline on a zoomed scale that is printed under the title. Domain colours come from the design tokens (status, category, type, priority, severity, test case and run tokens); the two chart series are `--tk-palette-0` and `--tk-category-done`. The KPI row follows spec §7 (open, done, open points, unassigned open), not the six tiles sketched in layout-and-screens §3.5, which need period deltas (I-80). Test case counts link to `/projects/{key}/test-cases?status=`; session names link to the session page.
- Rationale: small categorical counts read best as bars with exact numbers next to them; one chart library chunk (Chart.js) loads lazily for the only real time series.

### D-62 Search URL format, references and counts

- Question: how are search filters encoded so the search page, the API, the CSV export and dashboard links share them, and what happens to references the caller cannot read?
- Decision: one query-string format ([search-url-format.md](architecture/search-url-format.md)): short parameter names, comma-separated lists, plain dates meaning whole UTC days. The SPA copies its URL to `GET /tickets/search` unchanged. Project keys, users, parents and boards that are unknown or unreadable match nothing instead of failing, so a link never reveals that a private project exists. The dashboard needs got their own filters: `resolvedFrom/To`, `assigneeNot`, `fromRegression`, `severity=none` and `version=none`. The first page carries `total`, counted up to 1000 (`totalCapped`); counting to 10 000 cost up to 190 ms for common words at 200 000 tickets. Pages use keyset cursors on (sort key, id) that are bound to the sort. Text matching is OR-ed: full text (`websearch_to_tsquery('english')`, title A, description B), a title substring through the trigram index (3+ characters), and an exact ticket key.
- Rationale: one format means one parser (`SearchQueryParser`), which REST and MCP both use. The capped count keeps every search under 150 ms (verified with EXPLAIN ANALYZE on 200 000 seeded tickets, `SearchPerformanceTests`). That needed two global sort indexes, `(updated_at DESC, id DESC)` and `(created_at DESC, id DESC)` where not deleted.

### D-63 Attachment URLs and content checks

- Decision: attachment content lives at `/api/v1/attachments/{id}`, and markdown embeds it as `![name](/api/v1/attachments/{id})` (the spec said `/attachments/{id}`, which nginx would route to the SPA). The stored type is the declared type when it is allow-listed (common aliases such as `image/jpg` are mapped). For generic declarations (`application/octet-stream`, empty, Excel's CSV type) it comes from the extension. The bytes must then agree: binary types by signature, text types as UTF-8 with no binary signature, and JSON must parse. SVG and HTML are never accepted. Downloads send `nosniff`, a `sandbox` CSP and a private cache header. Images are inline unless `?download=true`. The ticket row is locked (`FOR UPDATE`) while counting toward the 50-file limit.
- Rationale: the URL works through the existing `/api` proxy and cookie session. Mapping by extension accepts what browsers actually send (Windows labels `.csv` as `application/vnd.ms-excel`) without trusting it.

### D-64 My work bounds

- Decision: `GET /me/work` returns at most 500 open tickets (projects by key, then priority, then most recently updated) with `truncated`, plus up to 200 waiting regression items from running sessions. Projects the user can no longer read are left out, even when tickets there are still assigned to them.
- Rationale: the page stays fast. The full list is the search link `assignee=me&category=ToDo,InProgress`.

### D-70 Bugs from regression items

- Question: §6.11 says completed sessions are immutable, but a tester may want to file the bug later. Who is "found by" in the template?
- Decision: bugs are created only while the session is `InProgress`; the UI opens the dialog right after a failure, so this is rarely a restriction. The server builds the draft (`GET …/items/{testCaseKey}/bug-draft`) and creates the bug through the tickets slice's `CreateTicket` (backlog top) and `LinkTickets` (RelatesTo). "Found … by X on date" names whoever recorded the failure, at that time. `record_regression_result` with `createBug` records the result and creates the bug in one transaction: if the bug is invalid (for example an unknown assignee), the result is not recorded either. Overrides: title, description, severity, priority, version, labels and assignee over REST; title, severity, priority and assignee over MCP (spec 9.3).
- Rationale: one draft builder means the web dialog, REST and MCP produce identical bugs. All-or-nothing avoids a recorded failure without the requested bug.

### D-71 Regression concurrency

- Decision: item writes (take, assign, result, bug) hold a shared row lock on the session for the transaction; complete and cancel take it exclusively. Two writes to the same item race on the item's row version, and the loser gets 409 `concurrency.conflict`. Sessions and items do not use `If-Match`.
- Rationale: a result can never land on a session that has just been completed, and "skip remaining" never overwrites a result recorded at the same moment. The locks are held for milliseconds.

### D-72 Test case and session read models

- Decision: the test case list returns `counts` (New, Manual, Automatic, Archived) for the text and ticket filters, ignoring the status filter, so the counts can serve as filter chips. Each row also carries the case's last result in a non-cancelled session. A test case view lists its last 10 runs. Session summaries come from one `GROUP BY` over the items per page, never from loading items. Session items are returned unpaged (bounded by the project's test cases) and are addressed by test case key (`WEB-TC-7`), item id or test case id.
- Rationale: testers see coverage and the latest outcome where they work. The items of one session are a small, bounded set that the execution view needs in full.

### D-73 Client addresses behind proxies

- Question: the login and set-password limits are per client IP, but the API trusted `X-Forwarded-For` from anyone (`ASPNETCORE_FORWARDEDHEADERS_ENABLED`) and the base compose file published the API port, so a client could bypass nginx and pick a new "IP" for every request.
- Decision: the base `docker-compose.yml` publishes only `web`; the API port (5080, for `ng serve`) and PostgreSQL are in `docker-compose.override.yml`, which a server does not load (`docker compose -f docker-compose.yml up -d`). The API reads `X-Forwarded-For` and `X-Forwarded-Proto` only from loopback and the CIDR ranges in `ForwardedHeaders__KnownNetworks` (compose: `TICKETING_TRUSTED_PROXIES`, default `172.16.0.0/12,192.168.0.0/16`, Docker's default address pools), and unwraps one hop (`ForwardedHeaders__ForwardLimit`, compose `TICKETING_FORWARD_LIMIT`). nginx appends the peer it saw, so the rightmost entry is the real client and anything a client prepends is ignored. With a TLS proxy in front of nginx, set the limit to 2 and add the proxy's address. nginx passes on the `X-Forwarded-Proto` it receives (else its own scheme). Invalid ranges fail startup.
- Rationale: the default trusts only private Docker networks, which in production only nginx can reach. In development the published API port is reached through Docker's gateway, which is inside those ranges, so spoofing works there; that is accepted for a development-only port.

### D-74 Sign-in lockout per account and address

- Question: the lockout told an attacker which emails exist (423 only for real accounts) and let anyone lock any account, including the last Admin, for everyone.
- Decision: failures are counted in `login_throttles` per (user, client address). Five in a row lock that pair for 15 minutes; a correct password from that address during the lock is refused too, and a success resets the pair. Every failure, locked or not, known email or not, is `401 auth.invalidCredentials`, and the password hasher runs on every path (a dummy hash for unknown emails), so neither the status nor the timing tells them apart. The per-address login rate limit (20 per minute) stays. Attempts for one account are still serialised by the user row lock. Admins see the latest active lock (`lockedUntil` in the user list); a set-password link lifts all of a user's locks. Rows without a failure for a day are purged by the retention job. `423` and `auth.lockedOut` no longer exist.
- Rationale: an attacker can only lock themselves out, while each address still gets five guesses per 15 minutes and 20 requests per minute. Counting unknown emails is unnecessary once a lock looks like a wrong password.

### D-75 Server-side web sessions

- Question: the session cookie was self-contained, so a copy kept working after sign-out until it expired (12 h, sliding).
- Decision: signing in inserts a `user_sessions` row; the cookie carries its id, and the per-request revalidation (which already re-reads the user and checks the security stamp, D-55) also requires the row. Sign-out deletes it; re-issuing a session (password change) replaces it. `last_seen_at` is written at most every 5 minutes; the retention job deletes sessions idle for longer than the cookie can live. Signing out ends only that session, not the user's others.
- Rationale: rotating the security stamp on sign-out would also have signed out every other browser of the user. The row lookup joins the user read that already runs on every cookie request. It is also the base for listing or ending sessions later (I-78).

### D-76 Hardening of the edges

- Decision:
  - The OpenAPI document needs a signed-in caller (cookie or any PAT) in Production; it stays anonymous elsewhere, where Scalar uses it. Scalar is not mapped in Production. nginx no longer has an `/openapi` location (the document lives under `/api/`).
  - `Strict-Transport-Security: max-age=31536000` is sent on SPA responses only when the request reached the stack over HTTPS (nginx's scheme or the TLS proxy's `X-Forwarded-Proto`). If the company proxy sets HSTS itself, it may also strip ours.
  - nginx logs a custom format: `/set-password` is logged without its query string (the token), and Referer headers without query strings.
  - Request bodies: nginx `client_max_body_size 11m` and Kestrel `MaxRequestBodySize` 11 MiB (a 10 MiB attachment plus multipart framing; the largest JSON body, 50 tickets with full descriptions, is smaller).
  - Text matched with `LIKE` is cut to 500 characters (the search `q` limit), and pages are clamped to 1..100 everywhere. There are no user-supplied regular expressions.
  - CSV export prefixes an apostrophe when a cell, after leading whitespace, starts with `= + - @`, or starts with a tab or CR.
- Rationale: closes the remaining findings of the security review without changing how the SPA works.


### D-65 Board read is one lean response

- Question: §2 pages lists, but a board shows up to 500 cards (D-04) in 8 columns, and quick filters and swimlanes regroup them instantly.
- Decision: `GET /boards/{id}` returns all 8 columns (or the `status` ones asked for) with every card the caller can read, in rank order, without paging. A card carries ids for its assignee and parent; users and parents (with the parent's own parent, so the UI can find the epic two levels up) are listed once beside the columns. One query loads the cards with parent and grandparent through the `(board_id, rank)` index; a second grouped query adds each card's sub-ticket progress (`childCount`, `childDoneCount`) through the `parent_id` index (500 cards with 450 children: about 30 ms in the integration test, up from about 24 ms). Quick filters (assignee, "only mine", type, label, project) and swimlanes run in the browser. MCP `get_board` inlines assignee and parent key into each card, because a model reads it once.
- Rationale: 500 lean cards are about 120 KB before gzip and one round trip; regrouping on the client keeps filters instant and the URL-driven filter state simple.

### D-66 One move endpoint for every placement

- Decision: `POST /tickets/move` (MCP `move_ticket`) covers backlog to board, board to board, board to backlog and reorders in either container. It reuses the backlog block-ranking primitive (D-48, `ITicketRanker.PlaceManyAsync`) and `Ticket.ChangeStatus` for the column's status, so moves and edits share the same side effects. Board rows touched by a move are share-locked; archive, delete and project changes lock the board exclusively, so no ticket lands on a board that is being archived. Users cannot move tickets onto or off an archived board.
- Rationale: one primitive for drag and drop and the model keeps ordering rules in one place, and lets a multi-select drag (I-11) be a single, all-or-nothing call.

### D-67 Board management details

- Decision:
  - Linking a project needs write access to it for the acting user (Admins always have it). Unlinking needs only read access, so an owner can't unlink a private project they cannot see, but an Admin can.
  - A user cannot unlink a board's last project (spec 4.13: 1..20). Project archive can still leave a board with none.
  - Carry-over to another board needs no permission on that board beyond it being active: placement only, as in D-44.
  - The archive result reports how many tickets went to the target board, to backlogs or stayed Done, counting only tickets the caller can read, so private work is not hinted at (spec 5.4).
  - Archived boards are read-only for renames, project changes and ownership transfer as well; unarchive and delete stay possible.
  - Board deletion is REST only (no MCP tool, spec 9.3) but is allowed to PATs, like other owner actions.
- Rationale: keeps D-44's "placement, not content" rule and the per-viewer counting rule of spec 5.4 consistent across every board operation.

### D-77 One application path for every placement change

- Question: the tickets slice shipped `POST /projects/{key}/backlog/rank` (`RankBacklogTickets`) and the boards slice `POST /tickets/move` (`MoveTickets`, D-66), which also reorders backlogs. Two handlers kept the same ranking rules.
- Decision: `MoveTickets` is the only handler for backlog reorder, backlog to board and back, board to board and column changes; the backlog rank endpoint is removed and the web backlog calls `/tickets/move` with target `backlog`. `MoveTickets` gained what only the rank endpoint had: `position` (`Top`/`Bottom`), 1..100 keys (was 50), and a stale-view guard: optional `from` (`backlog` or a board id) makes the call fail with 409 `ticket.notInSource` (was `ticket.notInBacklog`) when a ticket already left that container. The web backlog and board send `from`; MCP `move_ticket` does not need it.
- Rationale: one place for rank, status side effects, `ticket.moved` history and the no-history reorder rule (D-48). The more general handler won; the other only added the three features above.

### D-78 Field pickers from the keyboard

Superseded by D-81 for the meaning of `a` and `i`; the rest still holds.

- Question: the shortcut sheet in layout-and-screens.md used `A` for the assignee popover and `I` for "assign to me", while spec §10 and the backlog already used `a` for "assign to me" and the ticket view used `i`.
- Decision: `s`, `p` and `i` open the status, priority and assignee picker in the backlog, on the board and in the ticket view; they apply to the selection when there is one, otherwise to the focused ticket. `a` is "assign to me" everywhere (spec §10). On the board, the picker opens under the focused card; status changes there are column moves (bottom of the column, `POST /tickets/move`). Assignee pickers search `GET /users?projectKey=` as you type (any active user on public projects), never a members-only list.
- Rationale: one meaning per key across views, matching the spec; `i` reads as "assign…" and is free in all three views.

### D-81 Jira keys for assigning, plus type, labels, move and delete

- Question: D-78 made `a` "assign to me" and `i` the assignee picker. Our users come from Jira, where `a` opens the assignee field and `i` assigns to me (UX-07). Several keys were also missing (UX-08).
- Decision: replaces D-78's key meanings. In the backlog, on the board and in the ticket view, `a` opens the assignee picker and `i` assigns the selection (or the focused ticket) to the signed-in user and shows a toast with Undo, which puts back each ticket's previous assignee. Backlog and ticket view also get `t` (type picker), `l` (labels picker), `m` (backlog: move to a board; ticket view: move to the backlog or a board, through `POST /tickets/move`) and `Delete` / `⌘⌫` (D-82). The backlog bulk bar gains Type and Move to board. A picker shows its key hint only when that key is registered in the current scope (`ShortcutService.isRegistered`), and every shortcut is ignored while a dialog, menu or picker (any overlay with a backdrop) is open.
- Rationale: muscle memory beats internal consistency arguments; one meaning per key still holds across views.

### D-82 Ticket delete is immediate, with Undo that restores on the server

- Question: the UI asked "Delete?" in a dialog while the design asks for an immediate delete with an Undo toast (UX-36). Spec 6.2 removes links and test case references on delete and lists restore as LATER, so Undo needs a server-side restore that does not lose them.
- Decision: delete happens at once (lists drop the row, an open peek closes) and a toast offers Undo for its 8 seconds. Undo calls `POST /api/v1/tickets/{key}/restore`, Owner only like delete, allowed for 10 minutes after the deletion (`ticket.restore.expired`, `ticket.notDeleted` otherwise). The `ticket.deleted` activity entry now records what the delete removed: board, rank, links (other ticket, type, direction, original author and time) and the unlinked test case ids; the ticket history shows only key and board, so linked private tickets are not exposed. Restore brings back the parent if it is alive and still allowed, the links whose other ticket is alive, the test cases not linked elsewhere meanwhile, and the placement: the original board if it is active and still links the project (else the backlog), at the original rank when that slot is free (else the default position: board bottom, backlog top). It writes `ticket.restored`. REST only; no MCP tool.
- Rationale: an undo that only re-flags the row would silently drop links and test case coverage, which is worse than the confirm dialog; recording the removed relations in the delete entry keeps the schema unchanged and the undo complete. Ten minutes covers any Undo click with margin and keeps spec 6.2's "deleted is gone" semantics for everything older.

### D-83 Project sections live in the sidebar only

- Question: project pages had both sidebar sub-items and header tabs (UX-42); the mockups (backlog.html) show only the sidebar sub-items, a breadcrumb and the page's own header.
- Decision: the project frame drops the header row and tabs and keeps only the archived banner; Dashboard, Backlog, Test cases, Regressions and Settings are sidebar sub-items of the current project (also shown in the collapsed rail, with tooltips). The breadcrumb names the project, and the document title reads `<page> · <project> · Ticketing` (one `TitleStrategy` for every route). An archived project, which the readable-projects list leaves out, stays in the sidebar while the user is in it. An unknown or inaccessible key renders one project-level not-found state instead of a frame with a failing section.
- Rationale: one navigation path, as designed; the page header already says where you are, so the project header was a second title.

### D-84 Stale-while-revalidate for read models, and one request per GET

- Question: revisited pages rendered empty for 100–400 ms and the same GET often ran two or three times (UX-15, UX-16).
- Decision: `ApiClient` shares identical GETs that are in flight at the same time; any write starts a new generation, so a GET issued after a write never joins an older one. `SwrCache` (core) keeps the last value of a read model by key with tags: the project (`project:KEY`), the backlog per filter set, My work and the dashboard. A view renders the cached value at once and replaces it when the refetch answers; while such a background refetch runs, the shell shows its 2px top line. Ticket events drop the cached lists of the affected project and My work, a list stores its edited state when it is left, and signing in or out clears the cache. The ticket view keeps using `TicketCache` (prefetched on hover).
- Rationale: the spec's "cached data under 50 ms" with a small, explicit cache instead of a state library; tags keep invalidation coarse and safe.

### D-90 The test case editor autosaves

- Question: the editor had an explicit Save, and picking another case in the list silently threw away unsaved step edits (UX-04).
- Decision: an existing test case saves itself like ticket fields: 800 ms after the last change, when focus leaves a field, when a ticket is linked, and before the editor switches to another case or closes. Saves are serialized and each sends the latest `If-Match`, so typing during a save is sent next. The header shows `Unsaved changes`, `Saving…`, `Saved`, `Not saved: fix the errors` or `Couldn't save · Retry`. Edits that can't be saved (invalid, or the request failed) are kept as a per-case draft in the list's store, a toast with `Open` leads back, and opening the case restores them with a `Discard them` option. A new case is still created explicitly (`Create test case`, Ctrl/⌘+Enter); leaving it unfinished keeps it as the `new` draft. Escape closes after saving and asks before discarding only what can't be saved. A conflict still reloads the case with a warning.
- Rationale: no data loss and no extra click, consistent with the ticket view; creation stays explicit so half-typed cases don't appear in every regression session.

### D-91 Regression results are optimistic per item

- Question: P/F/S waited for the server and a single busy flag dropped key presses (UX-17).
- Decision: a result applies at once (item, filter counts and the summary bar, adjusted locally) and the view moves to the next waiting item without waiting. Calls for the same item run in order; different items run in parallel. The server's summary replaces the local one only when no call is pending. A failed call puts that item back, adjusts the summary back and shows a toast naming the case. Items being saved pulse in the list; Complete stays disabled until every call has answered, and reads `Complete (skip N waiting)…` while items wait (UX-41).
- Rationale: testers run through dozens of items with the keyboard; the server rarely rejects a result, and when it does the item is easy to find again.

### D-92 Semantic solids carry white text at 4.5:1

- Question: Pass/Fail used an undefined `--tk-text-on`, and white text on the success and danger solids measured 2.8:1 and 3.3:1 in dark mode, 3.2:1 and 3.9:1 in light mode (UX-19).
- Decision: new primitives `--tk-green-solid`, `--tk-red-solid` and `--tk-blue-solid` (light `#18794e` / `#ce2c31` / `#1f63c4`, dark `#268356` / `#d93036` / `#2f6fd6`) back `--tk-success`, `--tk-danger` and `--tk-info`. White on them is 4.6:1 or more in both themes, and as icon colours they keep at least 3.3:1 on dark surfaces. The bright hues (`--tk-green`, `--tk-red`, `--tk-blue`) stay for status and run icons, chart series, dots and tints. Warning keeps its near-black `--tk-warning-on-solid` (8.8:1 or more).
- Rationale: the semantic solid is a fill for text (Material's `error`/`on-error`, danger buttons, Pass/Fail); deeper shades of the same hues keep the palette while meeting AA.

### D-85 Demo data through the use cases

- Question: how to give a fresh install a realistic workspace for demos and screenshots without risking real data or duplicating domain rules.
- Decision: an opt-in seeder (`TICKETING_SEED_DEMO=true` at startup, or the `seed-demo` command) that runs only while no project exists, under a PostgreSQL advisory lock. It replays a planned twelve-week history (fixed random seed, dates relative to the time of seeding) through the application handlers as the demo users. It builds its own service provider from the normal registrations with a settable `TimeProvider` and an `ICurrentUser` for the acting user, so timestamps are backdated without touching production wiring. Never on by default; documented as development and demo only.
- Rationale: going through the handlers keeps keys, ranks, hierarchy, activity history, board moves and regression snapshots genuine and follows every later rule change for free; raw SQL inserts would drift from the domain. The "no project" guard makes it impossible to mix demo data into a real workspace.

### D-93 Watchers (and later notifications) are derived from the activity log at save time

- Question: who watches a ticket depends on what happens to it (created, assigned, commented, later mentioned), and tickets change through many paths: REST and MCP updates, bulk creation, moves, board and project relocations, bugs from regressions. Calling a "collaboration" service from each handler would miss paths and drift.
- Decision: every write already records `ActivityEntry` rows and saves once. A scoped `SaveChangesInterceptor` (`ActivityObserverInterceptor`) hands the activity entries added since the last save to every `IActivityObserver` inside `SaveChangesAsync`, before the write; the one observer, `CollaborationProjector`, reads them into typed events (`CollaborationEvents`), applies small rule sets (`WatchingRules` now; notification and mention rules in TKT-7/8) and adds what they derive (`TicketWatcher` rows) to the same unit of work. Each save costs a fixed number of batched queries (users' read access is cached for the request), whatever the number of entries. Synchronous `SaveChanges` with pending activity throws, because the observers are async. Watching itself is not activity: `PUT`/`DELETE .../watchers/me` write the row directly (`ON CONFLICT DO NOTHING` / delete), so they are idempotent and add no history.
- Auto-watch: the reporter and the assignee of a new ticket, every new assignee, every commenter (TKT-8 adds newly mentioned users). Only active users who can read the project; someone already watching is skipped. Unwatching holds until the next such trigger.
- Access: reading the ticket is enough to watch it, so viewers watch too, and so does anyone on an archived project; it needs a write-scoped token because it changes the caller's state. Watcher rows are kept when a user loses access or is deactivated, but every list (`watchers`, the `watching=true` search, My work) and every later notification checks `ProjectReaders` (active, and Admin, public project or member of any role, project not deleted) at read time, so such a watcher is hidden and gets nothing, and reappears if access returns.
- Rationale: the activity log is the single, already-complete record of what changed, written in the same transaction; deriving from it covers every current and future write path for free and keeps the rules in one testable place. Keeping rows instead of cleaning them up on membership changes needs no extra hooks and cannot leak, because readers are re-checked on every read.

### D-94 In-app notifications: one row per burst, summaries without user content, access checked on read

- Question: how to store and show notifications (I-30, TKT-7) so they are cheap to write on every change, never leak a project the reader lost, never keep text a user removed, and do not flood the bell when someone edits a ticket field by field.
- Decision:
  - Derivation: `NotificationRules` runs in `CollaborationProjector` after `WatchingRules` (D-93), so a watcher added by the same save (a new assignee, a first commenter) hears about the rest of it. Triggers: assignment of a ticket (created with or changed to an assignee) and of a regression item; for watchers, comment, status change, priority raised to High or Highest from a lower one, any board/backlog move (board archive and delete included, since they record `ticket.moved`) and deletion. The actor is never a recipient; recipients must pass `ProjectReaders` (active, can read the project) at write time. Mentions (TKT-8) only add another candidate source with kind `Mentioned`. Each save costs a fixed number of batched queries (watchers, readers, board and session names, open notifications), never one per recipient.
  - Model: one `notifications` row per recipient and burst: `Kind` (int enum, never renumbered), `Summary` (≤ 300), `EventCount`, `CreatedAt` (first event), `UpdatedAt` (last event), `ReadAt`. The summary is a short English sentence rendered on the server from field values and names (statuses, priorities, board and session names), never from user-written text such as comment bodies or descriptions, so deleting a comment leaves nothing behind. Ticket key and title are joined live when listing, so renames show and a deleted ticket shows as deleted.
  - Collapsing: key = recipient + actor (null for system changes) + ticket, or regression session for item assignments. An event merges into the newest unread row with that key whose `CreatedAt` is at most 5 minutes before it: the window is anchored on the first event, so a busy editor produces a new row every 5 minutes and rows never jump in a list ordered by `CreatedAt`. A read row is never reopened. The headline is the highest-ranked kind seen (Mentioned > Assigned > RegressionItemAssigned > Deleted > StatusChanged > PriorityRaised > Commented > Moved); equal or lower kinds only bump the count. Rows have no concurrency token: two simultaneous merges may lose one increment, which is better than failing the user's write.
  - Reading: list (newest first by `CreatedAt`, `Id`, keyset cursor) and unread count join `ReadableProjects()`; rows are kept when access is lost and simply not shown, like watcher rows (D-93), so they return with access and nothing leaks. Indexes: (recipient, read_at, created_at, id) for the unread count and for unread lists when few rows are unread, (recipient, created_at, id) for the full list (and unread lists when many are unread: a backward scan filtering `read_at`), created_at for retention; with 100 000 rows for one user every read stays under 20 ms (p95, `NotificationPerformanceTests`).
  - Mark read: one command for some ids (1..100) or `all` (rows created up to now), an `ExecuteUpdate` restricted to the caller's unread rows, so foreign or unknown ids are silently ignored (no existence leak) and the first read time is kept. It answers the new unread count so the badge needs no second call. It needs write scope (read-only PAT: 403) because it changes state, even if only the caller's.
  - Retention: rows older than 90 days (`Notification.Retention`) are deleted by the existing retention job.
- Rationale: one row per burst keeps the table and the bell small while `eventCount` still says something more happened; anchoring the window on the first event keeps both the merge rule and the ordering trivially stable. Server-rendered, content-free summaries are safe to keep for 90 days and identical for REST, MCP and the web. Re-checking access on read is the same proven approach as watchers.

### D-95 Sub-tickets graph: dagre layout, our own SVG and DOM rendering, behind a flag (TKT-23)

- Question: an epic's flat child list hides which children can start and which wait on others (TKT-10: 12 children, 13 `Blocks` links, 2 startable). How do we show "what blocks what", and with which library?
- Options considered (versions and licences checked on npm, bundlephobia and GitHub, 2026-10-27):
  1. **@dagrejs/dagre 3.1.3 for layout only, rendered by us** (MIT, 15.9 KB gz with graphlib, maintained, ESM + types). Nodes are Angular DOM cards, edges an SVG layer underneath. Real focus, ARIA, our `tk-*` components and CSS-token theming.
  2. **Mermaid 12.2** (MIT, 174 KB gz core). Planned for Docs (TKT-17) anyway, but click handlers need `securityLevel: 'loose'`, nodes cannot be our components, there is no per-node focus or ARIA, and theming goes through `themeVariables` instead of our tokens. Right for diagrams in docs, wrong for an interactive ticket view.
  3. **Hand-rolled layered layout** (≈3–4 KB, ours). No dependency, but wider layouts with more crossings, and we would own and test the crossing reduction and edge routing.
  - Rejected: elkjs 0.12 (437 KB, EPL-2.0/GPL), Cytoscape.js 3.34 (+ cytoscape-dagre, 150 KB, canvas: no DOM nodes for focus or ARIA), d3-dag 1.2 (42 KB, one maintainer), GoJS, yFiles and JointJS+ (commercial licences), d3-zoom (15.5 KB for what 100 lines of pointer and wheel handling do).
- Decision: option 1. `layoutGraph()` (`features/tickets/detail/graph/children-graph.layout.ts`) is the only file that imports dagre, so the layout engine can be swapped without touching the view. The graph component, dagre and the model load in their own `@defer` chunk (≈23 KB gz); the initial bundle and the ticket-detail chunk carry only the toggle. Layout is top to bottom over `Blocks` edges; children without any `Blocks` link go to a grid below ("No blocking links"); `RelatesTo` / `Duplicates` are dotted curves drawn under the cards and do not affect the layout. Pan (drag), zoom (buttons, Ctrl/⌘ + wheel, `+` `-`), fit (`0`), arrow keys between cards, Enter opens the peek.
- Rules: an open ticket is **blocked** when at least one open, readable ticket blocks it; otherwise **ready**; done tickets are **done** and their outgoing `Blocks` edges are drawn as satisfied (dashed). The **critical path** is the longest chain of open tickets over `Blocks` (by ticket count; ties go to the lower key); edges that close a cycle are ignored for it, and cycles are reported above the graph instead of failing.
- Data: `GET /api/v1/tickets/{key}/children/graph` and MCP `get_children_graph` (one handler, `GetChildrenGraph`) return the children, the links that touch them, and linked tickets outside the parent as external nodes. Tickets in projects the caller cannot read and deleted tickets are left out, so a hidden blocker neither appears nor counts as blocking. Nodes carry `blocked` for API and MCP readers; the SPA computes the same rule in `buildGraphModel` (tested with Vitest), because it also needs blockers, cycles and the critical path. The graph view keeps only external nodes tied by `Blocks`.
- Flag: `ticket.subtickets-graph` (off by default). Off: the section is exactly the old list. On: a List / Graph segmented control appears in the Sub-tickets header when the ticket has children; the choice is stored per user in this browser (`localStorage`, `tk-subtickets-view:<userId>`), default List. This is a section, not a routed page, so it uses `FeatureFlagService` directly rather than a view-registry variant (ADR 0008 covers pages). Turn it on at **Admin → Feature flags** (`/admin/flags`): create `ticket.subtickets-graph`, enable it, and target roles (for example `Admin`), users or a rollout percentage.
- Rationale: dagre gives Sugiyama-quality layouts for a few KB, while keeping rendering in our hands is what makes the graph keyboard-accessible, themeable in light and dark, and consistent with the rest of the ticket view. 50 tickets lay out in a few milliseconds (Vitest guards < 200 ms).

### D-96 @mentions are stored by user id, validated and notified only when newly added

- Question: how to store a mention so it survives renames, which texts take mentions, who may be mentioned, and how to notify once without re-notifying on every edit (I-33, TKT-8).
- Decision:
  - Format: a mention is stored in the markdown as `@[Display Name](user:<uuid>)`. The id is authoritative; the name is only the fallback text for readers who cannot resolve it. When a mention is written, `[`, `]`, `(`, `)` and line breaks are stripped from the name (an empty name becomes `user`). When reading, the name is 1+ characters without `[`, `]` or line breaks, and the id a hyphenated GUID in any case. Anything else is plain text. A mention whose `@` lies inside an inline code span (a run of N backticks up to the next run of exactly N) and fenced code blocks (up to 3 spaces, then 3+ backticks or tildes, closed by a line of the same character at least as long, or the end of the text) are not mentions; indented code blocks are not treated as code. `Mentions` (domain) and `mentions.ts` (web) implement the same rules.
  - Scope: ticket descriptions and comments only. Those editors offer the people picker; they are where mentions notify and make watchers. Other markdown fields (test cases, regression notes, project and board descriptions) are not normalized, and a token there renders as plain `@Name`.
  - Writing: clients may write `@email`. The server turns it into the stored form when the address belongs to an active user who can read the project; an address of no user stays plain text. Newly added mentions are rewritten with the user's current display name.
  - Validation of newly added mentions only (compared with the previous text of the same description or comment): a new mention, or `@email` of an existing user, who is inactive, unknown or cannot read the project fails with 400 `mention.invalid` (field `description` or `body`, the message names the users, hint "Only active users who can read project KEY can be mentioned."). Mentions already in the previous text are not checked, so a user who later lost access never blocks an edit.
  - Effects (`MentionRules` in the projector, D-93): each newly mentioned user, except the actor, starts watching and gets a `Mentioned` notification ("mentioned you in a comment" / "mentioned you in the description"). A watcher mentioned in a new comment gets `Mentioned` instead of `Commented` for it. Editing without adding mentions notifies nobody; removing a mention and adding it back later counts as new, and collapsing absorbs bursts.
  - Reading: `TicketDto.mentions` (description) and `CommentDto.mentions` are the mentioned users who are active and can read the project now, in order of first mention, resolved in one query per ticket load or comment page. Clients render those as chips with the current name and every other token as plain text.
  - Picker: `GET /users?projectKey=KEY&access=read` (and `find_users` with `access: Read`) lists active users who can read the project, viewers included; `access=write`, the default, keeps the assignee picker's meaning.
- Rationale: ids keep mentions stable across renames without rewriting stored text, and checking access when reading means a chip never reveals a user to someone who could not pick them. Comparing with the previous text is enough to tell new mentions from old ones without a mention table, and it keeps edits of old text working. Limiting mentions to the two texts people discuss in keeps the notification model simple; other fields can opt in later.

### D-97 Doc attachments share the attachments table through a nullable owner pair

- Question: page images (Docs, TKT-10) need attachments. Generalize the ticket attachment table, or add a separate `doc_attachments` table as the research suggested (refinement §5)?
- Decision: `attachments.ticket_id` becomes nullable and `attachments.doc_node_id` is added, with the check constraint `ck_attachments_owner` (`num_nonnulls(ticket_id, doc_node_id) = 1`). Same store, allow-list, 10 MiB limit, content sniffing and `/api/v1/attachments/{id}` URL; the limit for a doc is 200 (`Attachment.MaxPerDoc`, `Attachment.CreateForDoc`). Ticket reads join on `ticket_id`, so they never see doc attachments. The doc upload, list and delete use cases come with TKT-14, which also extends `AttachmentQueries.ReadAsync` to resolve a doc owner's project for the download check.
- Rationale: one attachment system means one download path, one access check and one backup story. Relaxing `NOT NULL` is additive (ADR 0006), and the check constraint keeps every row owned by exactly one thing. A second table would duplicate the metadata, the store wiring and the download authorization for no gain.

### D-98 The docs tree is serialized per project and ranked by the shared ranker

- Question: how to keep the docs tree rules (depth 6, 500 per folder, 5 000 per project, no cycles, sibling-unique titles) and keys race-free, and how to order siblings (TKT-12).
- Decision:
  - Every tree change (create, move, duplicate, delete, restore) first takes a transaction-scoped advisory lock on the project's docs tree (`docs:tree:{projectId}`), then loads the tree shape (ids, parents, kinds of non-deleted nodes) and checks the rules in memory (`DocTreeShape`). Content publishes lock only their own row (`SELECT … FOR UPDATE`), so versions are numbered one at a time without blocking the tree.
  - Sibling order uses the existing fractional-index ranker, generalized with a `DocFolder(projectId, parentId)` container whose lock is the same tree lock; rebalancing rewrites `doc_nodes`. `ITicketRanker` keeps its name; anchors carry an `ItemId`.
  - Doc numbers come from `project_counters` (`CounterKind.Doc`), like tickets, test cases and sessions (D-42), instead of the `Project.NextDocNumber` column the refinement proposed: same race-free upsert, and allocating a number does not bump the project's row version.
  - Sibling-unique titles are also a partial unique expression index (`ux_doc_nodes_sibling_title` on `project_id, parent_id, lower(title)` `NULLS NOT DISTINCT WHERE deleted_at IS NULL`), mapped to `doc.title.duplicate`, so a rename (which takes no tree lock) cannot race either.
  - The project root has no 500 limit; only folders do. Path segments escape `\` as `\\` as well as `/` as `\/`, so every title round-trips.
  - A stale `baseVersion` answers `doc.version.conflict` with `currentVersion`, `updatedBy` and `updatedAt` as extra members of the problem details and of the MCP error (`AppException.Details`); `updatedBy` is the author of the latest version.
  - Drafts may have an empty title while it is being typed; publishing still requires one.
- Rationale: a docs tree is small (at most 5 000 nodes) and written rarely compared with how often it is read, so one lock per project costs nothing and makes every multi-row rule exact, including cycle checks of concurrent moves, which per-folder locks could not guarantee. Reusing the ranker and the counters keeps one implementation of ordering and numbering.

### D-99 Canvas diagrams store Excalidraw JSON plus a light SVG snapshot per version (TKT-11)

- Question: what is a Canvas diagram's stored `Source`, and how do pages, dark mode, search and the PDF show it without loading the 450 KB editor (refinement §1.2, §5)?
- Decision:
  - `Source` is Excalidraw's own file JSON as `serializeAsJSON(..., 'database')` writes it (`type: "excalidraw"`, `elements`, a reduced `appState`, `files` empty in v1). It opens unchanged in excalidraw.com.
  - Every published Canvas version also has an **SVG snapshot**. The editor makes it with `exportSvg()`: light theme, background included, used glyphs subset and inlined. It is stored with the version, never edited on its own, and served as `image/svg+xml` behind a sandbox CSP (ADR 0013).
  - Pages embed the snapshot in an `<img>`. In dark mode the image gets `filter: invert(93%) hue-rotate(180deg)`, the transform Excalidraw uses for its own dark canvas. The PDF uses the snapshot as it is (always light).
  - A version written over MCP has no snapshot yet. The diagram view mounts the editor anyway, so when a writer opens it, the client exports the snapshot and stores it for that version without creating a new version. Until then embeds and the PDF show "Preview not rendered yet". Readers never write snapshots.
  - The server extracts the outline (`CanvasOutline.Extract`: labels in reading order plus `A → B (label)` relations from bound arrows, with `↔` and `—` for two-headed and headless arrows) on publish, for search (weight B) and MCP `get_doc`.
- Rationale: the native format keeps every Excalidraw feature and the round trip lossless. A snapshot per version makes embeds, history comparison and the PDF cheap and identical everywhere without a server-side Excalidraw. The outline gives LLMs and search the meaning of the drawing without the noisy element fields.

### D-100 PDF export renders the SPA's own markdown renderer offline in a Gotenberg sidecar (TKT-11)

- Question: §1.11 wants the same renderer for screen and PDF; the research proposed Markdig HTML. Which rendering source, and how is the renderer isolated?
- Decision:
  - A **print bundle** (`print.js`, `print.css`, the Inter font) is built from the SPA's `renderMarkdown` and Mermaid renderer with esbuild, plus SCSS compiled from the app's tokens and markdown styles. It must stay free of Angular imports, which its build checks.
  - For an export, the API checks access and resolves everything for the exporting user: content, references, embeds and their snapshots, page images (attachments) and the folder tree. It writes the data as JSON (`<` escaped) into `index.html` and posts the files to Gotenberg `8.39.0-chromium`. The script renders, sets `window.__printReady`, and Chromium prints A4 with header, footer and bookmarks.
  - The renderer never calls back and holds no user credentials, so no render token or print route is needed. Unreadable references are simply absent from the data, which makes the PDF leak rules the same as the screen's. Any URL that is not a bundle file is filtered by Gotenberg.
  - Isolation: an `internal` network shared only with `api`, no published port, basic auth, a `file:///tmp` allow-list with private and public IPs denied, download-from, webhooks, PDF-engine routes and metrics off, a read-only root file system with `tmpfs`, and memory and CPU limits (ADR 0013).
- Rejected: the SPA print route (Chromium would need network access to `web`/`api`, a new auth scheme and the whole SPA per export) and Markdig (a second markdown implementation that drifts).
- Rationale: one renderer without drift, and the strongest isolation. The renderer sees only what the API decided the user may see.

### D-101 PDF headers and footers are per export, not per document (TKT-11)

- Question: §1.11 puts `{DocKey} v{n}` in the footer centre, but Chromium's header and footer templates are fixed for a whole render (only page number, total pages, title, URL and date are filled in). A folder export must be one render, so contents links and cross-document links keep working.
- Decision:
  - Single page or diagram: footer as specified.
  - Folder export: the footer centre shows the folder's key and the document count (`TKT-D-12 · 50 documents`). The header shows `PK · folder title` and the folder path. Each document's first-page title block carries its own key, version, author and path.
  - The contents page has links but no page numbers (the accepted fallback of §1.11); PDF bookmarks follow folders, documents and headings.
  - The cover should carry no header or footer. TKT-20 tries `@page :first { margin: 0 }`; if Chromium still draws them, the cover keeps them in v1.
- Rationale: a correct single-render PDF with working internal links is worth more than a per-document footer. Rendering each document separately and merging would lose cross-document links and restart page numbers.

### D-102 Docs SPA: routes under `/projects/{PK}/docs`, one doc frame with content views per kind, a client-side tree (TKT-13)

- Question: the refinement writes doc URLs as `/p/{PK}/docs/{KEY}/{slug}` and lists one view id per kind, but a doc URL does not say its kind, and every other project section lives under `/projects/{PK}/…`. How should the SPA route docs, where do later stories (page editor, diagrams) plug in, and how much of the tree logic runs in the browser?
- Decision:
  - The Docs section is `/projects/{PK}/docs` (home), `…/docs/trash` (Owners) and `…/docs/{KEY}[/{slug}]`, like the other sidebar sections (D-83). `/docs/{KEY}` and `/p/{PK}/docs/…` (the form `DocQueries.Url` and MCP return) redirect there. A missing, stale or wrongly cased slug or key is replaced in place (`replaceUrl`).
  - View ids: `docs.layout` (tree + outlet), `docs.home`, `docs.trash`, and `docs.doc`, the routed frame of one doc (load, slug, title, breadcrumbs, page bar). The frame renders the content view for the doc's kind through the view registry: `docs.page`, `docs.diagram`, `docs.folder`, each taking the input `doc` and able to inject `DocStore`. TKT-14 replaces `docs.page`, TKT-17 and TKT-18 `docs.diagram`, without touching routes.
  - The tree is loaded whole (`GET …/docs/tree`, at most 5 000 nodes) into one `DocTreeStore` shared by every Docs view, cached with stale-while-revalidate, and rendered with fixed 28 px rows in a virtual scroll viewport. Expanded folders are kept per project in localStorage (`tk-docs-expanded:{PK}`), the panel width in `tk-docs-tree-width`.
  - Moves are checked in the browser with the server's rules (cycle, depth 6 counting the moved subtree, 500 per folder, sibling title, folder-only parents) before anything is sent, then applied optimistically; a refusal from the server rolls back only the moved subtree, keeping other changes made meanwhile. Creates show a pending row replaced by the server's node; renames and deletes are optimistic; Undo restores the delete group and reloads the tree, since a restore may rename or move it.
  - `Shift+D` drafts a Mermaid diagram; the inline row has a Mermaid | Canvas toggle. Single-key tree shortcuts (`N`, `Shift+N`, `Shift+D`, `F2`, `M`, `Del`, `J`/`K`, `Alt+↑/↓`) act on the tree cursor, which follows the open doc; arrow keys and `Enter` act only while the tree has focus, so they never take scrolling away from a page.
- Rationale: one URL shape for every project section keeps the sidebar, breadcrumbs and `G` shortcuts working unchanged, and the redirects keep the server's links valid. Resolving the content view by kind inside one frame gives every kind its own A/B seam without routing on data the URL does not carry. A 5 000-node tree is small enough to hold in memory, which makes the drop feedback (an invalid drop shows red) and the rollback exact without extra requests.

### D-103 Docs search: one ranked query, plain-text snippets from ts_headline, docs inside quick jump

- Question: how docs search (TKT-19, refinement 1.10) ranks, builds snippets that are "plain text plus highlight ranges, never HTML", and reaches the command palette.
- Decision:
  - One query over `doc_nodes` (the published copy; drafts live in `doc_drafts` and are never read) composed with `ReadableProjects()`. Text matches the generated `search_vector` (`websearch_to_tsquery('english')`), a title substring from 3 characters (trigram index) or a doc key. Relevance orders by `10 × exact key + 1 × title contains the text + ts_rank`, then `updatedAt`, `id`; at most 100, no cursor. Without text the only sort is `updated` with a keyset cursor (`updatedAt`, `id`).
  - Snippets come from `ts_headline` over the content (Canvas: the outline) with the control characters U+0002/U+0003 as start and stop marks, `MaxWords=30, MinWords=12, ShortWord=0`, run only for the returned page. `DocSnippets` turns that into text plus UTF-16 ranges, collapses whitespace, drops markdown emphasis and heading marks and cuts at 240 characters. HTML in content stays literal text; the SPA renders snippets with text bindings only.
  - `folder` resolves to the folder's whole subtree in memory from the project's folder rows (at most 5 000), so no recursive SQL. Unreadable or unknown projects, folders and tickets match nothing (no 404, no leak); a readable non-folder in `folder` is 400 `validation`.
  - Quick jump stays one request: the existing `/quick-jump` also answers doc keys and appends up to 5 docs with snippets after the tickets (`QuickJumpKind.Doc`, new optional fields). The palette's "Recent docs" (empty query) are the docs the user viewed last, kept per user in `localStorage` like recent boards, so they need no endpoint.
  - The endpoint lives in `SearchEndpoints` and the tool in `SearchTools`, next to ticket search, and reuses its query-string parameter reader.
- Rationale: one ranked query keeps search and quick jump consistent and fast (p95 under 150 ms with 20 000 docs and 200 000 tickets, `DocSearchPerformanceTests`). Control-character marks cannot be confused with markup in the content, and returning ranges instead of `<mark>` HTML keeps the API safe for every client, including LLMs.

### D-104 Palette scope prefixes `p:` and `t:` are registered scopes, answered by one scoped quick-jump request (TKT-40)

- Question: how the command palette narrows to docs (`p:`) or tickets (`t:`) as the docs design (screens §9) shows, without the core palette knowing about docs or tickets.
- Decision:
  - The core palette knows only `PaletteScope { id, prefix, hint }`, registered through `CommandRegistry.registerScope`. `parsePaletteQuery` strips a leading prefix (any case, leading spaces ignored). While a scope is active, commands are hidden, only search providers whose `scopes` list its id run, with the text after the prefix and the scope id, and a group shows up to 20 rows instead of 8. The footer lists `↑ ↓ navigate` and every registered scope's hint, the active one emphasised.
  - The search feature registers `p:` (docs only) and `t:` (tickets only). `/quick-jump` takes an optional `scope` (`Docs`, `Tickets`): a scoped request drops the other kinds, exact keys included (`t:` does not jump to test cases or sessions), and returns up to 20 items instead of 10 tickets / 5 docs. The key jump and the "Search … for" rows follow the same scope; `p:` with no text shows the recent docs.
  - The hint reads "docs only" rather than the mockup's "pages only", because the Docs group also holds diagrams and folders.
- Rationale: keeping the prefixes as data in a registry keeps `core/` free of feature knowledge and lets another feature add a prefix without touching the palette; one scoped request keeps the server the single place that ranks and authorizes results.

### D-105 Page editor: CodeMirror split view, client-side 3-way merge with "touching" as a conflict, seams for later stories (TKT-14)

- Context: TKT-14 adds the page reader and editor (refinement 1.6–1.8). It needs an editor that keeps markdown byte for byte, a merge for concurrent edits, code highlighting, page attachments, and room for history (TKT-15), links (TKT-16), Mermaid (TKT-17) and comments (TKT-21) without editing the page views again.
- Decision:
  - **Editor**: CodeMirror 6 (`@codemirror/*` 6.x, MIT) with hand-picked extensions in the lazy `docs.page.edit` chunk (119 KB gz). The markdown language is wired as `new LanguageSupport(markdownLanguage)` plus `markdownKeymap`, not `markdown()`, which would pull `@codemirror/lang-html`, CSS and JavaScript parsers (+57 KB gz) for HTML blocks we show as text anyway. `Mod+S`, `Mod+Enter` and `Esc` stay with `ShortcutService` (CodeMirror's `Mod+Enter` binding is dropped). The source and preview panes use `contain: strict`, the preview gets its own layer and its blocks `content-visibility: auto`; together that cut the per-keystroke work on a 100 000-character page from about 16 to about 10 ms. Timing budgets live in `*.perf.spec.ts` files of a separate Playwright `perf` project that only runs on request (`E2E_PERF=1`), because parallel workers skew the numbers.
  - **Merge**: line-based 3-way merge on the client (`three-way-merge.ts`, line diffs from jsdiff `diff` 9.0.0, BSD-3-Clause, a lazy chunk that TKT-15 reuses for its diffs). Changes of the two sides whose base ranges overlap **or touch** conflict (git's rule); identical changes merge once. The base text is the version the draft started from, fetched with the new `GET /docs/{key}/versions/{n}` when it is not the one loaded. The title is sent only when it differs from the base version's title, so a rename by someone else is not undone by a content publish.
  - **Highlighting**: highlight.js 11 core with 23 registered languages, loaded only when a rendered block names a known language (32 KB gz). `highlightCodeBlocks(root)` is free of Angular so the PDF bundle (TKT-20) can call it; the markdown viewer of tickets uses it too. Colours come from the hue `-fg` tokens.
  - **Callouts** are rendered by `renderMarkdown` for every markdown surface, with the classes `tk-md-callout*` (the app already uses `tk-callout` for form alerts). Heading ids are opt-in (`headingAnchors`), because tickets render many markdown blocks on one page.
  - **Page attachments** get their own `DocAttachmentDto` (`docKey` instead of `ticketId`) and REST-only routes; MCP lists them with `list_doc_attachments`, and `get_attachment_text` reads them. Uploads and deletes are activity only (no version, `updatedAt` unchanged); listing a folder or diagram returns `[]`, uploading to one is 409 `doc.kind.unsupported`.
  - **Seams** (`core/docs/doc-extensions.ts`): `provideDocPageSection({ id, order, placement: 'footer' | 'rail', loadComponent })` for reader sections (input `doc`), `provideDocMarkdownEnhancer({ id, order, enhance(host, { mode, theme, docKey, signal }) })` run after every render of a doc's markdown (reader and preview), and `provideDocEditorPlugin({ id, order, toolbar, slashCommands, extensions })` for toolbar buttons, `/` commands and CodeMirror extensions. Docs stories register them in the `providers` of the docs routes. The edit session (`DocEditSession`) and the merge live in `features/docs/editing/` so the Mermaid editor can reuse them.
- Rationale: the merge has to run where both texts and the user are, and treating touching edits as conflicts is the conservative rule people know from git; a lost line costs more than one extra conflict view. The seams keep the page view and editor closed for modification while four stories extend them in parallel.

### D-106 Doc comments share the comments table, notify the doc's participants and live in a footer section (TKT-21)

- Question: page comments (docs refinement D12) need storage, rules, notifications and a place in the reader. A separate `doc_comments` table, or the ticket comments generalized? Whom does a new doc comment notify while watching docs is out of scope?
- Decision:
  - `comments.ticket_id` becomes nullable and `comments.doc_node_id` is added with `ck_comments_owner` (`num_nonnulls(ticket_id, doc_node_id) = 1`), like attachments (D-97). The `Comment` entity and its rules (edit own, delete own or as Owner, placeholder, previous body to activity) are shared; `Comment.CreateForDoc` makes a doc comment. Ticket lookups and lists filter on `ticket_id`, doc ones on `doc_node_id`, so `/comments/{id}` never reaches a doc comment and `/docs/comments/{id}` never a ticket comment (404 `comment.notFound`). Doc comments get their own `DocCommentDto` (`docKey`, no `mentions`) and use cases (`AddDocComment`, `ListDocComments`, `UpdateDocComment`, `DeleteDocComment`).
  - Comment writes are activity on the doc (`doc.comment.added`, `doc.comment.edited` with only the previous body in the old value, `doc.comment.deleted`); they create no version and leave `updatedAt` and the row version alone, like page attachments. `DocDto.commentCount` counts comments that are not deleted. Comments follow the doc through delete and restore because nothing touches them.
  - Notifications go through the collaboration projector (D-93): a `doc.comment.added` entry becomes a `DocCommentAdded` event; the rule notifies the doc's participants, its creator and the authors of its earlier comments that are not deleted, with `Commented` ("commented"), never the actor and only readers. `notifications.doc_node_id` (cascade) is the third subject next to ticket and regression session; collapsing compares it too, the list returns `doc: { key, title, deleted }` and `url` points at `…#comments`.
  - Web: a `comments` footer section (`provideDocPageSection`, order 90). `DocPageSection.kinds` limits a section to some kinds (attachments: pages; comments: pages and diagrams); diagram views render the footer sections too. The thread store (`DocCommentsStore`) adds, edits and deletes optimistically and reports count changes, so the meta line ("3 comments") and the section header update at once. `Shift+C` focuses the composer.
- Rationale: one comments table keeps one set of rules and one moderation story, and the owner check makes every row belong to exactly one thing (D-97's argument). Participants are the closest thing to watchers without the watch feature, so review threads are answered without new state; deleting your only comment is the way out until watching docs arrives.

### D-107 Doc history: one merged history endpoint, restore as an ordinary publish that keeps drafts, diffs on the client (TKT-15)

- Context: TKT-15 adds version history, viewing and comparing versions and restoring one (refinement 1.6, 1.12, 1.13). The refinement names `GET /docs/{key}/versions` for history, but the list it describes merges versions with activity.
- Decision:
  - **History** is `GET /docs/{key}/history?limit=&cursor=` (MCP `get_doc_history`): `{ docKey, currentVersion, items, nextCursor }`, newest first. Items of type `Version` (number, title, change note, author, channel, `restoredFrom`) are merged with every doc activity entry no version represents; `doc.updated`, `doc.version.restored` and, for pages and diagrams, `doc.created` are left out because the version rows are those events. Activity added later by other stories (comments, TKT-21) shows up without changes. One keyset cursor `(at, id)` pages both sources: each side reads `limit + 1` rows after the cursor and the merge keeps the first `limit`.
  - **Reading a version**: `GET /docs/{key}?version=n` and `get_doc` with `version` return the doc as it is now with `content` replaced by version n's (and, since TKT-50, the references and embeds of that content, resolved on the fly with the index's parser and read filter) and `atVersion` describing it; `title`, `path` and `version` stay the current ones, so the response never suggests a stale `baseVersion`.
  - **Restore** (`POST /docs/{key}/versions/{n}/restore`, optional `{ changeNote }`; MCP `restore_doc_version`) goes through `DocPublisher` with `restoredFrom = n`: version n's title and content become a new version, the title is renamed back first (a sibling with that title now is 409 `doc.title.duplicate`; no `doc.renamed` entry, the version carries the title). It needs no `baseVersion`, since nothing is lost. Restoring what the latest version already is writes nothing (safe for LLM retries). It records `doc.version.restored` (`{ version, restoredFrom }`) instead of `doc.updated` and **keeps the restorer's draft**: the draft was not published, and the editor's 3-way merge applies it onto the restored version like onto any newer one.
  - **Web**: `?history=n[&with=m]` opens the history view (`docs.history`, a lazy chunk holding jsdiff) in place of the page bar and content: a 320 px panel of versions and activity grouped by day, and a comparison: an older version alone is compared with the current one (what a restore would change), the current one with its predecessor, Shift+click picks a second version. Changes show a unified or side-by-side line diff (layout remembered per browser) with word highlights inside paired lines and folded unchanged runs; Canvas diagrams show both versions rendered side by side. `?v=n` renders one version (`docs.version`) under "You are viewing v3 of 7 · Back to latest". `H` toggles the history, `Esc` closes it, Restore asks for confirmation (no optimistic update: the server creates the version).
  - **Diff**: common head and tail lines are skipped before jsdiff's Myers diff runs on the middle with a 250 ms timeout; on timeout the changed region is shown as removed then added. Word highlights only for paired lines up to 2 000 characters whose changed share is at most 60 %. Two 100 KB versions with 100 edited and 25 inserted lines diff in about 20 ms (Vitest budget 300 ms).
  - Deviation from the mockup: version rows show the change note and "Restored from vN" but no `+12 −3` line counts, which would need a diff per row on the server; the counts are shown above the diff instead. (Row counts added by D-112.)
- Rationale: one endpoint gives the panel and LLMs the whole story in order without a second request; making restore a normal publish keeps `DocPublisher` the only writer (references, Canvas outline and later hooks apply to restores for free), and keeping drafts makes restore lossless for everyone, including the restorer.

### D-108 Doc references: an index rebuilt in the publisher, resolved per reader into the doc GET, rendered by the shared renderer (TKT-16)

- Question: how ticket mentions, doc links and diagram embeds (refinement 1.8, 1.9) are found, stored and shown without leaking private projects and without one request per key.
- Decision:
  - **Parsing** lives in the domain (`DocReferenceParser`) and mirrors the renderer: upper-case keys with the renderer's boundaries, code spans, fenced (also inside quotes and lists) and indented code blocks and URLs skipped, `![caption](KEY)` read as an embed. Mermaid sources are scanned as text; Canvas waits for its own story. At most 500 distinct tickets and 500 docs per content.
  - **Indexing** happens in `DocPublisher` (publish and the initial version of create and duplicate), so every write path, MCP included, keeps `doc_references` current. The rebuild is a diff (delete stale rows, add new ones) in the publish transaction. Targets resolve across all projects, deleted ones included, so restoring a ticket or doc brings its mentions back without re-indexing; reads filter instead.
  - **Reading**: `DocDto` gains `references` (tickets with status for chips, docs with deleted flag), `embeds` (readable, non-deleted diagrams, Mermaid with its source so the renderer needs no second request) and `backlinks` (50 newest + total). They are part of every doc a write returns, so the reader re-renders chips right after publishing. Everything is composed with `ReadableProjects()`: what a reader cannot see is absent, not masked, so the API never says that a hidden key exists. A deleted doc keeps only its key ("KEY (deleted)").
  - **A ticket's docs** are a use case of the docs feature (`GetTicketDocs`, `GET /tickets/{key}/docs`) and an opt-in `TicketIncludes.Docs`. MCP `get_ticket` includes it by default (`TicketIncludes.Everything`); the REST ticket read leaves it out, because the web section loads it lazily and the ticket GET is the hottest read.
  - **Rendering** stays in `renderMarkdown` (Angular-free, PDF included) behind a `references` option: chips use a DOM-built status ring (`statusGlyph`, shared with `tk-status-icon`) and classes, not inline styles, so the page CSP holds. Without the option (tickets, comments) every key links by route, doc keys to `/docs/KEY`. The editor preview links keys it cannot resolve yet instead of hiding them, since the author typed them.
  - **Embeds** are placeholders (`figure.tk-doc-embed[data-doc-key][data-diagram-format][data-version] > .tk-doc-embed-body`, min-height 160 px) that the diagram stories fill through a markdown enhancer reading `DocMarkdownContext.embeds`.
  - **Seams added**: `provideDocEditorPlugin` accepts a factory (to `inject()` clients); `markdownCompletions` is a CodeMirror facet for plugin completion sources (the editor's `override` keeps language-data sources out); a page section hides itself with the host class `tk-section-empty`.
- Rationale: one index written where versions are written cannot drift from the content, and resolving it inside the doc GET keeps rendering to zero extra requests (the AC) while the readability filter sits in one query per list. Absent-rather-than-masked references are the only shape that cannot leak a title, a status or even existence.

### D-109 Docs tree panel collapses with `Ctrl \`; `Ctrl .` / `Ctrl Shift .` copy the doc key and link; shifted symbol shortcuts match the physical key (TKT-39)

- Question: the refinement (1.1, 1.16) collapses the tree with `[` and copies the key / link with `⌘.` / `⌘⇧.`. `[` already toggles the app sidebar, `]` toggles the page's right rail (screens.md 3), and screens.md uses `Ctrl Shift .` for a heading link instead. Also, `Ctrl Shift .` never fired anywhere: browsers report the shifted character (`>`), and `ShortcutService` drops `Shift` for symbols, so the ticket view's "Copy link" was dead.
- Decision:
  - `Ctrl \` (`⌘\`) shows and hides the tree panel, as in Notion; buttons in the tree header and in the 40 px strip that replaces the collapsed panel do the same. The state is remembered per browser (`tk-docs-tree-collapsed`, like the width). A collapsed tree is removed, so its single-key shortcuts (`N`, `J`/`K`, `Del`…) are off; `Ctrl Shift E` opens it and focuses it.
  - `Ctrl .` copies the open doc's key and `Ctrl Shift .` its link, the same keys as on a ticket (refinement wins over screens.md; copying a heading link stays with the hover anchor).
  - `ShortcutService` first tries the physical-key form of a shifted symbol (`mod+shift+.` from `event.code` `Period`), then the reported character (`?`), so both notations work on any layout that has the key.
- Rationale: the bracket keys are taken by the two other panels, and a modifier keeps the tree toggle from firing while reading. Matching shifted symbols by physical key fixes the ticket shortcut as well without per-layout tables.

### D-110 Mermaid: lazy blocks with remembered heights, one diagram view with renderer and editor registries (TKT-17)

- Context: TKT-17 renders Mermaid in every markdown surface and as diagram docs with an editor, under two constraints from the epic: Mermaid stays out of the initial bundle and a page with ten diagrams must not shift while they render. TKT-18 (Canvas) shares the diagram view right after, and the PDF bundle (TKT-20) reuses the renderer.
- Decision:
  - **One block renderer** `renderMermaidBlocks(root, theme, { lazy, signal, lastGood })` in `shared/diagrams/mermaid/mermaid-blocks.ts`, free of Angular. `tk-markdown` (tickets, comments) and the docs markdown enhancer both call it; the PDF bundle calls it with `lazy: false`. The theme reaches `shared/` through the `DIAGRAM_THEME` token, which the app config provides from `ThemeService`. `tk-markdown` re-creates its HTML on a theme change only when the source mentions `mermaid`.
  - **Lazy with reserved height**: one shared IntersectionObserver (600 px margin). Until a block renders it is a skeleton of the height it had on this device last time (localStorage, newest 300, keyed by a hash of the source) or of an estimate by diagram type and statement count. Rendered SVGs are cached per source and theme (64), so cached blocks are replaced synchronously and the editor preview and theme toggles don't flicker.
  - **Errors**: a block that does not parse stays as code followed by a danger box with Mermaid's message; in the editor preview the last good render of that block stays, dimmed, above it.
  - **Diagram doc view** `docs.diagram` serves every format: `DIAGRAM_RENDERERS[format]` turns a diagram's source into `{ element, width, height }` (Mermaid: inline SVG) for a zoom/fit viewport and for embeds; `DIAGRAM_EDIT_VIEWS[format]` names the editor view for `?mode=edit` (Mermaid: `docs.diagram.mermaid.edit`). `hasDocEditor(doc)` replaces `DOC_EDITABLE_KINDS`: pages, and diagrams whose format has an editor. Canvas adds one entry to each map.
  - **Mermaid editor** reuses the page's `DocEditSession` (drafts, autosave, publish, 3-way merge, conflict view); the draft banner and the editor's status line became shared components (`tk-doc-draft-banner`, `tk-doc-edit-status`). CodeMirror gets a small stream tokenizer for Mermaid instead of a language package; editor plumbing shared by both editors (`replaceDocument`, the theme) moved to `codemirror-shared.ts` so the Mermaid chunk does not pull the markdown language.
  - **Seam addition**: `DocEditorCommandContext.injector`, so editor plugins can open dialogs that use the docs layout's stores (the insert-diagram picker reads `DocTreeStore`).
  - **MCP** `create_diagram` (`format` defaults to Mermaid, `source`) on `CreateDoc`; the create/update tool descriptions list the seven supported types. No server-side Mermaid validation (I-104).
- Rationale: a renderer per surface would drift from the PDF; remembering heights is the only way to know a diagram's size before Mermaid has run, and the estimate keeps the first visit within "good" CLS. Registries keyed by format keep the diagram view closed for modification while Canvas plugs in.

### D-111 "On this page" is a rail from 1440 px that `]` hides, otherwise a popover in the page bar; content views add page bar actions through `DocBarSlot` (TKT-45)

- Question: the reader shows "On this page" only from 1440 px (refinement 1.1). screens.md 3 wants a popover button in the page bar on narrower screens and `]` to toggle the rail, but the page bar belongs to the `docs.doc` frame while the outline lives in the page view.
- Decision:
  - From 1440 px the 220 px rail shows unless the reader hid it with `]` or its hide button; that choice is remembered per browser (`tk-docs-rail-hidden`). Whenever the rail is not shown, the page bar has an "On this page" button that opens a popover with the same outline (scroll spy, smooth scroll, closes on a pick or `Esc`) and the registered rail sections; below 1440 px `]` opens and closes the popover. Pages without headings or rail sections show neither.
  - The rail and the popover render rail sections only while visible, so a section component exists once.
  - The frame provides `DocBarSlot`; a content view puts a template into it (`set(template)` returns the remover) and the frame renders it first on the bar's right side. The editor and the history replace the bar, so the page view clears the slot in edit mode.
  - The button shows below 900 px too (the ticket names 900–1439 px); narrow screens are best effort and lose nothing by it.
- Rationale: one rule ("the button shows when the rail does not") covers both the laptop width and a hidden rail. A template slot keeps the outline state in the page view, with no outline service shared between the frame and the content view.

### D-112 Version line counts are computed once at publish and stored on the version (TKT-48)

- Question: the history mockup shows "+12 −3" on every version row. TKT-15 (D-107) diffs only in the browser, for the selected comparison; a count per row needs each version diffed against its predecessor.
- Decision:
  - `DocPublisher` counts the lines when it snapshots a version (`DocLineDiff`, a Myers line diff in the domain after skipping common head and tail lines) and stores them in `doc_versions.lines_added` / `lines_removed` (migration `AddDocVersionLineCounts`, nullable). Version 1 counts against empty content, a restore against the version it replaces. Canvas diagrams store null: their JSON lines mean nothing to a reader.
  - `GET /docs/{key}/history` and `get_doc_history` return `linesAdded` / `linesRemoved`; the row shows "+a −r" after the time (hidden when both are 0 or null), with "a lines added, r removed against vN" as tooltip.
  - No backfill: docs have not shipped, so no version predates the columns outside test stacks; such versions show no counts.
- Rationale: counting once at publish costs one diff of the content the publisher already holds (typical edits skip most lines as common head and tail; a fully rewritten 100 KB page is unit-tested to stay under 500 ms) and makes the history a plain read, for the panel and for LLMs. A browser-side count would download every visible version's content.

### D-113 Canvas: rules and outline in the publisher, a picture per version filled once, pictures everywhere outside the editor (TKT-18)

- Context: D-99 fixed the stored format (Excalidraw JSON plus a light SVG per version). TKT-18 had to decide where the rules run, how a version written over MCP gets its picture, what the reader shows, and how the draft/conflict flow of pages fits a drawing.
- Decision:
  - **Rules in `DocPublisher`.** Every publish of a Canvas (create, update, duplicate, version restore) runs `CanvasSource.Validate`: a JSON object with `type: "excalidraw"` and an `elements` array (else `doc.diagram.invalidSource`), at most 10 000 elements (`doc.diagram.tooManyElements`), no `image` element and empty `files` (`doc.diagram.embeddedFiles`), no `embeddable`/`iframe`, element links only `http(s)://` or app-relative. It returns the outline, stored with `SetOutline` (labels and relations, `\n`-separated). Drafts are not validated. Canvas docs written before TKT-18 get an outline on their next publish.
  - **The picture** (`doc_versions.snapshot_svg`, lz4) is sent as `snapshot` with `content` (`POST /projects/{pk}/docs`, `PATCH /docs/{key}`) and checked by `CanvasSnapshot.Normalize`: well-formed XML without a DTD, an SVG root, no `script`/`foreignObject`/frames/media, no `on*` attributes, `href` only fragment, `data:image/`, `http(s)` or app-relative, at most 5 000 000 characters. It is served by `GET /docs/{key}/versions/{n}/snapshot.svg` (readers; `image/svg+xml`, `sandbox; default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:`, `nosniff`, private cache one day). The check makes the stored SVG inert even where it is inlined (TKT-20's print bundle), not only behind the CSP.
  - **Filled once.** `PUT /docs/{key}/versions/{n}/snapshot` (writers, Canvas only) stores a picture for a version that has none and creates no version and no activity; the first one wins (`stored: false` afterwards), so a client cannot repaint history. Restore and duplicate copy the picture of the version they copy. Publishing unchanged content with a picture fills the current version the same way.
  - **Outside the editor only pictures.** The diagram view, page embeds, the history comparison and the conflict view draw the picture in an `<img>` (dark: Excalidraw's `invert(93%) hue-rotate(180deg)`); Excalidraw (450 KB + 732 KB for the first export) loads only in the editor. When the picture is missing the diagram view exports one in the browser from the source and, for a writer looking at the latest version, stores it (`DiagramRender.exported`); embeds show "Preview not rendered yet" instead of loading Excalidraw for every reader of a page. This deviates from D-99's "the view mounts the editor anyway".
  - **Editing.** `docs.diagram.canvas.edit` reuses `DocEditSession` with `textMerge: false` and an `attach` hook that adds the picture to every publish; the drawing is serialized into the draft 400 ms after the last change. A stale base opens the conflict view without "Keep editing on latest": both drawings side by side, Overwrite with mine (theirs stays in history) or Discard mine. New Canvas docs open in the editor. Images are refused on paste and drop ("Images go in pages").
  - **Keyboard.** Excalidraw owns single-key tools and `Esc`. `ShortcutService` treats focus inside an element marked `data-own-keys` (the Canvas editor), and on the body while one is shown, like a text field: only `allowInInputs` shortcuts (`Mod+S`, `Mod+Enter`) fire. Close is a button.
- Rationale: one validation point keeps REST, MCP and restore consistent; pictures keep readers, history and PDF cheap and identical without a server-side Excalidraw; write-once pictures let readers' and writers' clients fill gaps without trusting them to rewrite history.

### D-114 "Write doc" from a ticket creates a top-level page named after the ticket; a `#mention-KEY` fragment opens a doc at the first mention (TKT-49)

- Question: screens.md 9 wants "+ Write doc" in the ticket's "Docs mentioning this ticket" section, creating a page "in the project's default folder" prefilled with `Related: KEY`, and rows that scroll to the first mention. Projects have no default folder, and a new page needs a title that is free among its siblings.
- Decision:
  - The page goes to the top level of the ticket's project, titled `KEY Ticket title` (cut to fit 200 characters); when a sibling has that title the client retries with " (2)" up to " (5)". Its content is `Related: KEY`, so the index lists it under the ticket at once, and the editor opens (`?mode=edit`). The button shows to writers of the ticket's project (`ticket.permissions.canEdit`), in the section header, which stays hidden while no doc mentions the ticket (as the design says).
  - Rows link to `docUrl(...)#mention-KEY` (`mentionFragment`). The page reader resolves that fragment to the first ticket chip with `data-ticket-key="KEY"` (set by `renderMarkdown`), scrolls it to the middle and plays `tk-mention-flash` (600 ms, `--tk-accent-subtle`); other fragments still go to heading ids.
  - Rows keep showing the last editor: the index does not record who added a mention (D-108).
- Rationale: the top level is the only folder every project has; naming the page after the ticket makes it findable in the tree and in search without asking for a title first.

### D-115 Drafts too large for a keepalive request are saved normally on unload, behind the browser's "Leave site?" prompt (TKT-72)

- Question: editors save unsaved changes on `beforeunload` with `fetch(..., { keepalive: true })`, but browsers drop keepalive bodies over 64 KB, so the last second of a big Canvas drawing (up to 2 MB) was lost silently. Compressing does not bound the size, and synchronous requests are not allowed while a page is being dismissed.
- Decision: `DocsApi.saveDraftOnUnload` sends only bodies of at most 60 000 UTF-8 bytes (`fitsKeepalive`) and reports whether it did. Otherwise `DocEditSession.saveOnUnload(event)` starts a normal draft save and cancels the `beforeunload` event, so the browser shows its own "Leave site?" prompt while the request runs; staying keeps editing, leaving after it finished loses nothing. Small drafts behave as before, without a prompt.
- Rationale: the prompt appears only when there is something unsaved that could not be sent, which is the honest answer; it costs no server change.

## Product owner answers (v1 review, 2026-10-27)

These were open questions (Q-01..Q-05); the product owner resolved them as follows.

### Q-01 What Jira data do we migrate? — Decided: nothing

- Decision: no Jira migration. Teams start fresh in Ticketing; Jira history stays in Jira (or its export) until the contract ends. No migration script and no importer.
- Consequence: D-11's one-off migration script is dropped; the REST API needs no import support (original keys, backdated timestamps). The built-in importer (I-48) stays in the ideas backlog only.

### Q-02 Is v1 acceptable without notifications? — Decided: yes

- Decision: v1 ships without notifications; My work covers "what's on me". In-app notifications (I-30) are the first post-v1 item.

### Q-03 Do teams run Scrum sprints? — Decided: boards are enough

- Decision: boards plus archive with carry-over (D-09) for v1; sprint metrics only if teams ask.

### Q-04 Should Admins see private projects? — Decided: yes

- Decision: Admins see and manage every project, private ones included (D-17).

### Q-05 Owner-only destructive actions on public projects — Decided: confirmed

- Decision: on public projects, ticket deletion, deleting other people's comments, assigning regression items to others and hard-deleting test cases stay with Owners; everything else is open to every signed-in user (D-02).
