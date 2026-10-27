# Glossary

Domain terms used in the spec, the code, the UI and the API. Section links point to the normative [refined spec](product/01-refined-spec.md) (`§`), the [decision log](decisions.md) (`D-xx`) and the [ADRs](adr/README.md). Enum values are written as they travel over the API (`ReadyForTesting`); the UI shows display labels.

**Activity entry**: One append-only record of a change: who (actor), when, through which write channel, what action, and the old and new value of a field. It serves both as ticket history and as the admin audit trail; entries are never edited or deleted. [§4.14](product/01-refined-spec.md#414-activityentry-history-and-audit)

**Admin**: Global role with full user, token and feature-flag administration and `Owner` access to every project, private ones included (D-17). At least one active Admin must always exist. [§5.2](product/01-refined-spec.md#52-global-actions)

**Archive (board)**: Makes a board read-only. The owner chooses where non-Done tickets go (their backlogs or another board); Done tickets stay as a record. Unarchive is allowed. [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Archive (project)**: Makes a project read-only for everyone; the only allowed action is unarchive. Its tickets leave all boards and the project is unlinked from them. Writes on an archived project fail with 409 `project.archived`. [§4.3](product/01-refined-spec.md#43-project)

**Archive (test case)**: Hides a test case from default lists and from future regression sessions without deleting it. [§6.10](product/01-refined-spec.md#610-test-case-lifecycle)

**Assignee**: The active user responsible for a ticket, who must be able to write to its project. Optional. Regression items have their own assignee. [§4.5](product/01-refined-spec.md#45-ticket)

**Attachment**: A file (max 10 MiB, allow-listed types, 50 per ticket) attached to a ticket and stored in PostgreSQL behind `IAttachmentStore`. [§4.8](product/01-refined-spec.md#48-attachment-i-07)

**Audit trail**: The admin view of activity entries for users, tokens, projects and flags. See Activity entry. [§4.14](product/01-refined-spec.md#414-activityentry-history-and-audit)

**Auto-passed**: UI label for a regression item whose execution mode is `Automatic`: it starts as `Passed` with no executor. Anyone with write access can still change it, for example to `Failed` (D-13). [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Automation ratio**: Share of runnable test cases that are automated: `Automatic / (Manual + Automatic)` over non-archived cases; `New` cases do not count. Shown on the dashboard. [§7](product/01-refined-spec.md#7-project-dashboard)

**Backlog**: The ordered list of a project's tickets that are not on any board (`BoardId = null`). Every project has exactly one. [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Blocked ticket**: An open ticket that at least one open, readable ticket blocks (a `Blocks` link). Shown red in the sub-tickets graph; the opposite is a ready ticket. [D-95](decisions.md)

**Board**: A named, ordered container that can hold tickets from up to 20 linked projects. Every signed-in user can see every board, but only cards from projects they can read. Boards replace sprints (D-09). [§4.12](product/01-refined-spec.md#412-board), [§5.4](product/01-refined-spec.md#54-board-actions)

**Board column**: One column per ticket status, always all 8, in status order. A column shows the board's cards with that status in rank order. The brief calls these "swimlanes" (D-29). [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Board owner**: The user who manages a board's name, linked projects, archive and deletion; the creator by default, transferable. [§4.12](product/01-refined-spec.md#412-board)

**Bootstrap admin**: The first Admin, created at startup from `TICKETING_BOOTSTRAP_ADMIN_EMAIL` and `TICKETING_BOOTSTRAP_ADMIN_PASSWORD` when the user table is empty. [§6.14](product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)

**Bug**: Ticket type for a defect. Severity is shown prominently for bugs. Bugs can be created from a failed regression item. [§3](product/01-refined-spec.md#3-enumerations), [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Bug draft**: The pre-filled bug the server builds from a failed regression item's snapshot (title, templated repro steps, Severity Major, Priority High, session version, label `regression`). The create-bug dialog, REST and MCP all start from it (D-70). [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Canvas outline**: The text of a Canvas diagram that the server extracts from its Excalidraw JSON: labels in reading order plus connector relations such as `API → DB (SQL)`. It feeds search and MCP (D-99). [ADR 0013](adr/0013-diagram-editor-and-pdf-pipeline.md)

**Canvas snapshot**: The light SVG image of one Canvas diagram version (fonts inlined), made by the editor on publish. Pages embed it, dark mode inverts it with CSS, and the PDF prints it (D-99).

**Carry-over**: Moving a board's unfinished tickets elsewhere when it is archived: to their project backlogs (top) or to another non-archived board. [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Channel**: See Write channel.

**Child**: See Parent / child.

**Collapsing (notifications)**: Merging rapid changes into one notification: an event by the same actor on the same ticket (or regression session) within 5 minutes of the first event of an unread notification raises its event count instead of adding a row; the highest-ranked kind becomes the headline (D-94). [§6.16](product/01-refined-spec.md#616-in-app-notifications-i-30-d-94)

**Comment**: Markdown text on a ticket, listed oldest first. Authors edit or delete their own; Owners delete any; a deleted comment leaves a placeholder. [§4.7](product/01-refined-spec.md#47-comment), [§6.9](product/01-refined-spec.md#69-comments)

**Container**: Where a ticket sits: its project backlog or exactly one board. Rank orders tickets within a container. [§6.4](product/01-refined-spec.md#64-backlog-and-boards), [§6.6](product/01-refined-spec.md#66-ranking)

**Critical path**: In the sub-tickets graph, the longest chain of open tickets connected by `Blocks` links, counted in tickets. Links that close a cycle are ignored. [D-95](decisions.md)

**Deactivation**: The only way to remove a user. It blocks login, revokes all their PATs and hides them from pickers, while their name stays on history as "Name (deactivated)" (D-12). [§4.1](product/01-refined-spec.md#41-user)

**Delete group (docs)**: The docs deleted by one delete: a doc, or a folder with its whole subtree. Its members share `DeletedRootId`; restore and the trash work on whole groups. [§12.5](product/01-refined-spec.md#125-delete-and-restore)

**Doc**: A node of a project's docs tree: a `Folder`, a markdown `Page` or a `Diagram` (`Mermaid` or `Canvas`). Pages and diagrams have versions; folders hold other docs, up to 6 levels deep. [§12](product/01-refined-spec.md#12-docs)

**Doc draft**: A user's private, unpublished edit of a page or diagram, autosaved by the editor. Others only see that the user is editing. Publishing creates a version and deletes the draft. [§12.4](product/01-refined-spec.md#124-content-versions-and-drafts)

**Doc key**: `{ProjectKey}-D-{n}`, for example `WEB-D-12`, for every kind of doc. Numbered per project from one counter, never reused, case-insensitive on lookup. [§12.1](product/01-refined-spec.md#121-model-and-keys)

**Doc path**: A doc's titles from the root joined by `/` (`Architecture/ADRs/0001 Use Postgres`), case-insensitive; `/` inside a title is written `\/`. Unique because titles are unique within a folder. [§12.1](product/01-refined-spec.md#121-model-and-keys)

**Doc search**: Search over doc titles, the latest published content and Canvas labels in readable projects (never drafts or deleted docs), by relevance or newest first. Each result carries a snippet. [§12.7](product/01-refined-spec.md#127-search)

**Doc version**: An immutable full snapshot of a page or diagram's title and content, numbered 1..n, created by every publish. `baseVersion` names the version an edit started from. [§12.4](product/01-refined-spec.md#124-content-versions-and-drafts)

**Effective access**: A user's resulting role on a project, computed from global role, membership and visibility. It decides every project permission. [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Epic**: Ticket type for a large body of work. An epic cannot have a parent; it is usually the top of a hierarchy. [§6.3](product/01-refined-spec.md#63-parent-and-child)

**Execution mode**: Snapshot of a test case's status (`Manual` or `Automatic`) taken when a regression session starts. It decides whether the item waits for a tester or is auto-passed. [§4.11](product/01-refined-spec.md#411-regressionsessionitem)

**Expected version**: The row version a client last saw, sent as `If-Match` (REST) or `expectedVersion` (MCP). A stale value makes the update fail with a conflict. See Row version. [§2](product/01-refined-spec.md#2-cross-cutting-conventions)

**Feature flag**: A named switch, managed by Admins, that evaluates per user to a variant through master switch, user targets, role targets and a stable percentage rollout. [§4.15](product/01-refined-spec.md#415-featureflag), [§6.13](product/01-refined-spec.md#613-feature-flags-and-view-variants), [ADR 0007](adr/0007-feature-flags.md)

**Field hints**: Suggestions of version and label values already used in a project, most recent first. Hints never restrict input. [§6.7](product/01-refined-spec.md#67-field-hints-version-labels)

**Global role**: `Admin` or `User`; exactly one per user. [§3](product/01-refined-spec.md#3-enumerations)

**Hard delete**: Permanent removal. In v1 it exists only for test cases that never appeared in a regression session and for attachments; everything else is soft-deleted or deactivated. [§6.10](product/01-refined-spec.md#610-test-case-lifecycle)

**Idempotency key**: Optional client-chosen value on create calls (`Idempotency-Key` header, MCP `idempotencyKey`). A repeat with the same key and user within 24 hours returns the original result instead of creating a duplicate. [§8](product/01-refined-spec.md#8-rest-api)

**Key**: Human-readable identifier. See Project key, Ticket key, Test case key, Regression session key. [§6.1](product/01-refined-spec.md#61-keys)

**Label**: A lower-case tag on a ticket (max 20 per ticket, `^[a-z0-9][a-z0-9._-]{0,49}$`). "Backend" and "backend" are the same label. [§4.5](product/01-refined-spec.md#45-ticket), [§6.7](product/01-refined-spec.md#67-field-hints-version-labels)

**Linked project**: A project attached to a board. Only tickets of linked projects can be placed on that board. [§4.13](product/01-refined-spec.md#413-boardproject)

**MCP (Model Context Protocol)**: The protocol LLM clients such as Claude Code use to call tools. Ticketing serves it at `/mcp` over Streamable HTTP, authenticated with a PAT, exposing the same use cases as REST. [§9](product/01-refined-spec.md#9-mcp-server), [ADR 0004](adr/0004-in-process-mcp-server.md)

**Lockout**: After 5 failed logins in a row from one client address, the account is locked for that address for 15 minutes (`LoginThrottle.LockedUntil`, D-74). It looks like a wrong password to the caller. [§6.14](product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)

**Member**: Project role that can read and write tickets, test cases and regressions, but not delete tickets, moderate comments or manage the project. Every signed-in user has Member access to a public project. [§5.3](product/01-refined-spec.md#53-project-actions)

**My work**: Page listing the current user's open tickets across projects, their waiting regression items and the open tickets they watch. [§6.8](product/01-refined-spec.md#68-search-lists-and-export)

**Mention**: A reference to a user in a ticket description or comment, written with the `@` people picker or as `@email`, stored as `@[Name](user:<id>)` so it survives renames. Only active users who can read the project can be newly mentioned; a new mention notifies them once and makes them a watcher, and readers see it as a chip with the current name (others see plain text) (D-96). [§6.9](product/01-refined-spec.md#69-comments)

**Notification**: An in-app message to one user about a change someone else made: assigned to them (ticket or regression item), mentioned, or a comment, status change, priority raised to High/Highest, move or deletion on a ticket they watch. Created in the same transaction as the change, shown under the bell, listed only while the user can read the project, purged after 90 days (D-94). See Collapsing. [§6.16](product/01-refined-spec.md#616-in-app-notifications-i-30-d-94)

**Open**: A ticket whose status category is not `Done`. Used in dashboards and filters. [§3](product/01-refined-spec.md#3-enumerations)

**Owner**: Project role with full control of a project: settings, members, archive, ticket deletion, comment moderation, assigning regression items to others. Admins act as Owner on every project. A non-archived project always has at least one active Owner. [§4.3](product/01-refined-spec.md#43-project), [§5.3](product/01-refined-spec.md#53-project-actions)

**Parent / child**: Hierarchy between tickets of the same project via `ParentId`: at most 3 levels, no cycles, epics have no parent. Children are independent of their parent's status and placement. [§6.3](product/01-refined-spec.md#63-parent-and-child)

**PAT (personal access token)**: A secret (`tkt_` + 40 base62 characters) a user creates to call REST or MCP as themselves. It has a scope and a mandatory expiry; only its SHA-256 hash is stored and it is shown once. [§4.2](product/01-refined-spec.md#42-personalaccesstoken), [§6.12](product/01-refined-spec.md#612-pat-lifecycle), [ADR 0003](adr/0003-authentication-cookie-and-pat.md)

**Print bundle**: The offline page the PDF renderer prints: the SPA's markdown and Mermaid renderer built into one script, print styles from the design tokens, and a JSON block with the documents the exporting user may read. It needs no network and calls nothing back (D-100). [ADR 0013](adr/0013-diagram-editor-and-pdf-pipeline.md)

**Priority**: How soon a ticket should be worked on: `Highest`, `High`, `Medium` (default), `Low`, `Lowest`. Required on every ticket. [§3](product/01-refined-spec.md#3-enumerations)

**Private project**: Visible only to its members and Admins. To anyone else it does not exist: the API answers 404 and it never appears in search, boards, hints or MCP. Default visibility (D-32). [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Project**: A container for tickets, test cases and regression sessions, with its own members, backlog and dashboard. Any user can create one. [§4.3](product/01-refined-spec.md#43-project)

**Project key**: Short immutable code (`^[A-Z][A-Z0-9]{1,9}$`, for example `WEB`) that prefixes all keys in the project. Unique forever, including archived and deleted projects (D-10). [§4.3](product/01-refined-spec.md#43-project)

**Project role**: `Owner`, `Member` or `Viewer`; exactly one per membership. [§3](product/01-refined-spec.md#3-enumerations), [§4.4](product/01-refined-spec.md#44-projectmember)

**Public project**: A project every signed-in user can read and write with Member access (D-02). Settings, membership and destructive actions stay with Owners. [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Quick jump**: `Ctrl+K` or `/`: type a ticket, test case, regression session or doc key to open it, or text to list the 10 best ticket title matches and, below them, the 5 best docs with a snippet, across readable projects. With an empty query the palette lists recently viewed docs. [§6.8](product/01-refined-spec.md#68-search-lists-and-export), [§12.7](product/01-refined-spec.md#127-search)

**Rank**: Hidden fractional-index string that orders tickets within their container; compared byte-wise (`COLLATE "C"`). [§6.6](product/01-refined-spec.md#66-ranking), [ADR 0010](adr/0010-fractional-index-ranking.md)

**Ready ticket**: An open ticket that no open ticket blocks, so work on it can start. Shown green in the sub-tickets graph. [D-95](decisions.md)

**Regression bug**: A ticket created from a failed regression session item (the item's `BugTicketId`). The dashboard counts the open ones. [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Regression item**: One test case inside a regression session: a snapshot of the case plus its own status, assignee, result note and optional bug. [§4.11](product/01-refined-spec.md#411-regressionsessionitem)

**Regression item status**: `WaitingForExecution`, `Passed`, `Failed` (needs a result note), `Skipped`. [§3](product/01-refined-spec.md#3-enumerations)

**Regression session**: One run of a project's ready test cases, usually for a version. It starts with all non-archived `Manual` and `Automatic` cases and ends `Completed` or `Cancelled`. Several can run in parallel (D-22). [§4.10](product/01-refined-spec.md#410-regressionsession), [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Regression session key**: `{ProjectKey}-R-{n}`, for example `WEB-R-3`. [§6.1](product/01-refined-spec.md#61-keys)

**Reporter**: The user who reported a ticket; defaults to its creator and can be changed. [§4.5](product/01-refined-spec.md#45-ticket)

**Resolution**: Why a ticket is done: `Done`, `WontDo`, `Duplicate`, `CannotReproduce`. Set if and only if the status is `Done`. [§3](product/01-refined-spec.md#3-enumerations), [§6.2](product/01-refined-spec.md#62-ticket-lifecycle)

**Row version**: PostgreSQL `xmin` exposed as `rowVersion`, used for optimistic concurrency on every mutable aggregate. [§2](product/01-refined-spec.md#2-cross-cutting-conventions), [ADR 0005](adr/0005-postgresql-and-ef-core.md)

**Scope (PAT)**: `ReadOnly` or `ReadWrite`. A token acts with its user's current permissions intersected with its scope; no token can manage tokens, passwords, users or flags. [§5.5](product/01-refined-spec.md#55-pat-scope)

**Set-password link**: One-time link an Admin hands to a user so they can set a password: valid 72 hours for a new user, 24 hours for a reset. No email is sent in v1. [§6.14](product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)

**Severity**: Impact of a problem: `Blocker`, `Critical`, `Major`, `Minor`, `Trivial`. Optional on every ticket, prominent on bugs (D-26). [§3](product/01-refined-spec.md#3-enumerations)

**Snapshot**: The copy of a test case's title, preconditions, steps, expected result, automation reference and mode stored in a regression item at session start. Later edits to the test case never change it (D-20). [§4.11](product/01-refined-spec.md#411-regressionsessionitem)

**Soft delete**: Marking a record deleted (`DeletedAt`) instead of removing it. Used for tickets, projects and boards; deleted records vanish from lists, but their keys stay reserved. [§2](product/01-refined-spec.md#2-cross-cutting-conventions), [§6.2](product/01-refined-spec.md#62-ticket-lifecycle)

**Spike**: Ticket type for time-boxed research or investigation. [§3](product/01-refined-spec.md#3-enumerations)

**Sprint**: Not a concept in Ticketing. Boards with archive and carry-over cover the sprint workflow (D-09).

**Stale ticket**: An open ticket not updated for 30 days; shown on the dashboard. [§7](product/01-refined-spec.md#7-project-dashboard)

**Status**: Where a ticket is in its work: `ToDo`, `InProgress`, `OnHold`, `Review`, `ReadyForTesting`, `Testing`, `ReadyForDeploy`, `Done`. Any status can move to any other (D-05). [§3](product/01-refined-spec.md#3-enumerations), [§6.2](product/01-refined-spec.md#62-ticket-lifecycle)

**Status category**: Derived grouping of statuses for statistics: `ToDo` = {ToDo}, `InProgress` = the six middle statuses, `Done` = {Done}. [§3](product/01-refined-spec.md#3-enumerations)

**Story points**: Optional integer estimate, 0..100. The UI suggests Fibonacci values (D-27). [§4.5](product/01-refined-spec.md#45-ticket)

**Technical**: Ticket type for engineering work without direct user-facing value, such as refactoring or infrastructure. [§3](product/01-refined-spec.md#3-enumerations)

**Test case**: A reusable, project-level description of a check: title, preconditions, ordered steps, expected result, status, optionally linked to one ticket of the same project (D-19). [§4.9](product/01-refined-spec.md#49-testcase), [§6.10](product/01-refined-spec.md#610-test-case-lifecycle)

**Test case key**: `{ProjectKey}-TC-{n}`, for example `WEB-TC-7`. [§6.1](product/01-refined-spec.md#61-keys)

**Test case status**: `New` (not ready, excluded from regressions), `Manual` (needs at least one step) or `Automatic` (auto-passed in regressions). [§3](product/01-refined-spec.md#3-enumerations), [§6.10](product/01-refined-spec.md#610-test-case-lifecycle)

**Ticket**: The unit of work: title, markdown description, type, status, priority, severity, story points, version, labels, parent, assignee, comments, attachments and links. [§4.5](product/01-refined-spec.md#45-ticket)

**Ticket key**: `{ProjectKey}-{n}`, for example `WEB-42`. Numbers come from a per-project counter, are never reused and are looked up case-insensitively. [§4.5](product/01-refined-spec.md#45-ticket), [§6.1](product/01-refined-spec.md#61-keys)

**Ticket link**: A typed relation between two tickets, possibly in different projects: `Blocks` / is blocked by, `RelatesTo`, `Duplicates` / is duplicated by. Parent/child is not a link. [§4.6](product/01-refined-spec.md#46-ticketlink-i-05)

**Ticket type**: `Epic`, `UserStory`, `Technical`, `Spike` or `Bug`. Changeable, subject to the parent/child rules. [§3](product/01-refined-spec.md#3-enumerations)

**User**: (1) A person with an account. (2) The non-admin global role, which can create projects and boards and manage their own tokens. [§4.1](product/01-refined-spec.md#41-user), [§5.2](product/01-refined-spec.md#52-global-actions)

**User story**: Ticket type (`UserStory`) for a user-facing requirement. [§3](product/01-refined-spec.md#3-enumerations)

**Variant**: The string a feature flag evaluates to for a user. In v1 always `on` or `off`; a string so A/B tests can add variants later (D-14). [§6.13](product/01-refined-spec.md#613-feature-flags-and-view-variants)

**Version**: Free text (max 50 characters, case-sensitive) naming the release a ticket or regression session belongs to. [§4.5](product/01-refined-spec.md#45-ticket), [§6.7](product/01-refined-spec.md#67-field-hints-version-labels)

**View registry**: Frontend map from view id (for example `ticket-detail`) to the component variants that render it. Every routed page resolves through it, so an A/B variant can be added later without changing routes (D-14). [§6.13](product/01-refined-spec.md#613-feature-flags-and-view-variants), [ADR 0008](adr/0008-ab-ready-views.md)

**Viewer**: Project role with read-only access to a private project. It has no effect on a public project, where everyone has Member access (D-16). [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Visibility**: `Private` (default) or `Public`; decides who can access a project without membership. [§3](product/01-refined-spec.md#3-enumerations)

**Watcher**: A user who follows a ticket. Anyone who can read the ticket may watch it; the reporter, the assignee (on each assignment), commenters and newly mentioned users start watching automatically. Only active watchers who can still read the project are shown or notified; the others stay stored but hidden (D-93). [§6.15](product/01-refined-spec.md#615-watchers-i-32-d-93)

**Write channel**: How a write arrived: `Web` (browser session), `Api` (PAT over REST) or `Mcp` (PAT over MCP). Recorded on every activity entry. [§2](product/01-refined-spec.md#2-cross-cutting-conventions)
