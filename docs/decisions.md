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
- Decision: no importer in v1. Migration runs as a one-off script. What to migrate is Q-01.
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

- Question: the shortcut sheet in layout-and-screens.md used `A` for the assignee popover and `I` for "assign to me", while spec §10 and the backlog already used `a` for "assign to me" and the ticket view used `i`.
- Decision: `s`, `p` and `i` open the status, priority and assignee picker in the backlog, on the board and in the ticket view; they apply to the selection when there is one, otherwise to the focused ticket. `a` is "assign to me" everywhere (spec §10). On the board, the picker opens under the focused card; status changes there are column moves (bottom of the column, `POST /tickets/move`). Assignee pickers search `GET /users?projectKey=` as you type (any active user on public projects), never a members-only list.
- Rationale: one meaning per key across views, matching the spec; `i` reads as "assign…" and is free in all three views.

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

## Needs product owner

None of these block v1. The implementation follows each recommendation provisionally; the product owner confirms or overrides them at the v1 review.

### Q-01 What Jira data do we migrate?

- Why it matters: decides whether the REST API needs extra import support (preserving created dates, original keys) before launch.
- Options: nothing (fresh start); open tickets only; everything including closed history.
- Recommendation: open tickets and open epics with comments and attachments, via a one-off script. Store the original Jira key in the description's first line. Closed history stays in a Jira export kept read-only until the contract ends. No built-in importer (D-11).

### Q-02 Is v1 acceptable without notifications?

- Why it matters: it is the gap teams will notice first.
- Options: ship v1 without, with a My work page; add in-app notifications to v1 (adds about 2 weeks).
- Recommendation: ship without; build in-app notifications (I-30) as the first post-v1 item.

### Q-03 Do teams run Scrum sprints in Jira today?

- Why it matters: if velocity and burndown are used in planning, boards plus archive (D-09) will feel like a step back.
- Recommendation: boards plus archive with carry-over for v1; sprint metrics later if teams ask.

### Q-04 Should Admins see private projects?

- Why it matters: projects for HR, legal or security work may be expected to be invisible even to IT admins.
- Recommendation: yes, Admins see everything (D-17). If that is unacceptable, Admins instead get only "add myself as Owner", which notifies the project's Owners.

### Q-05 Confirm Owner-only destructive actions on public projects

- Why it matters: it narrows the PO's "full write" answer.
- Recommendation: on public projects, keep ticket deletion, deleting other people's comments, assigning regression items to others and hard-deleting test cases with Owners. Everything else is open to every signed-in user.
