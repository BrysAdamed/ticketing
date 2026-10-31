# Glossary

Domain terms used in the spec, the code, the UI and the API. Section links point to the normative [refined spec](product/01-refined-spec.md) (`§`), the [decision log](decisions.md) (`D-xx`) and the [ADRs](adr/README.md). Enum values are written as they travel over the API (`ReadyForTesting`); the UI shows display labels.

**Achievement**: Private, tiered recognition a user earns for real actions in the app (creating and closing tickets, testing, linking, delegating to an agent, a few secret ones), through any channel, MCP and PATs included. Visible only to its owner, Admins included, unless the owner shares it; never revoked; counted only from when the `achievements` flag turns on for the user or they opt (back) in; an opt-out deletes it. Not a performance metric: no leaderboards, points or time-based criteria. Not the same as the UI **Badge** component of the design system (D-144).

**Activity entry**: One append-only record of a change: who (actor), when, through which write channel, what action, and the old and new value of a field. It serves both as ticket history and as the admin audit trail; entries are never edited or deleted. [§4.14](product/01-refined-spec.md#414-activityentry-history-and-audit)

**Admin**: Global role with full user, token and feature-flag administration and `Owner` access to every project, private ones included (D-17). At least one active Admin must always exist. [§5.2](product/01-refined-spec.md#52-global-actions)

**Agent delegation**: Handing a ticket to a coding agent (Claude Code): Ticketing renders the prompt for the ticket's type and the browser opens Claude's deep link with it. Behind the `agent.delegate` flag; projects opt in. [§13](product/01-refined-spec.md#13-agent-delegation)

**Agent setup**: A project's agent delegation settings, changed by Owners in the web app: enabled, repository URL, default branch, merge policy, and what delegating does to the ticket (assign to the delegating user if unassigned; move `ToDo` to `InProgress`). [§13.3](product/01-refined-spec.md#133-domain-model)

**Agent prompt template**: The text a delegated agent starts from, per ticket type: an instance default edited by Admins, optionally overridden per project (`Inherit`, `Custom` or `Off`). Every change is an immutable version. Only trusted placeholders are allowed, never the ticket title, description or comments. [§13.3](product/01-refined-spec.md#133-domain-model), [§13.4](product/01-refined-spec.md#134-template-language)

**Archive (board)**: Makes a board read-only. The owner chooses where non-Done tickets go (their backlogs or another board); Done tickets stay as a record. Unarchive is allowed. [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Archive (project)**: Makes a project read-only for everyone; the only allowed action is unarchive. Its tickets leave all boards and the project is unlinked from them. Writes on an archived project fail with 409 `project.archived`. [§4.3](product/01-refined-spec.md#43-project)

**Archive (test case)**: Hides a test case from default lists and from future regression sessions without deleting it. [§6.10](product/01-refined-spec.md#610-test-case-lifecycle)

**Assignee**: The active user responsible for a ticket, who must be able to write to its project. Optional. Regression items have their own assignee. [§4.5](product/01-refined-spec.md#45-ticket)

**Attachment**: A file (max 10 MiB, allow-listed types, 50 per ticket) attached to a ticket and stored in PostgreSQL behind `IAttachmentStore`. [§4.8](product/01-refined-spec.md#48-attachment-i-07)

**Audit trail**: The admin view of activity entries for users, tokens, projects and flags. See Activity entry. [§4.14](product/01-refined-spec.md#414-activityentry-history-and-audit)

**Auto-passed**: UI label for a regression item whose execution mode is `Automatic`: it starts as `Passed` with no executor. Anyone with write access can still change it, for example to `Failed` (D-13). [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Automation ratio**: Share of runnable test cases that are automated: `Automatic / (Manual + Automatic)` over non-archived cases; `New` cases do not count. Shown on the dashboard. [§7](product/01-refined-spec.md#7-project-dashboard)

**Avatar**: The picture shown for a user: initials on a colour hashed from the user id, unless the user picked an animal icon (32 Fluent Emoji animals, D-130) and/or a named palette colour from the code-defined avatar catalogue. The web app reads every chosen avatar from one directory (`GET /users/avatars`); user DTOs and MCP tools do not carry it (D-129). [§4.1](product/01-refined-spec.md#41-user)

**Backlink**: A doc whose latest content links to another doc (by key or `[text](KEY)`); listed under "Linked from" on the linked doc, readable and non-deleted ones only.

**Backlog**: The ordered list of a project's tickets that are not on any board (`BoardId = null`). Every project has exactly one. [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Blocked ticket**: An open ticket that at least one open, readable ticket blocks (a `Blocks` link). Shown red in the sub-tickets graph; the opposite is a ready ticket. [D-95](decisions.md)

**Board**: A named, ordered container that can hold tickets from up to 20 linked projects. Every signed-in user can see every board, but only cards from projects they can read. Boards replace sprints (D-09). [§4.12](product/01-refined-spec.md#412-board), [§5.4](product/01-refined-spec.md#54-board-actions)

**Board column**: One column per ticket status, always all 8, in status order. A column shows the board's cards with that status in rank order. The brief calls these "swimlanes" (D-29). [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Board owner**: The user who manages a board's name, linked projects, archive and deletion; the creator by default, transferable. [§4.12](product/01-refined-spec.md#412-board)

**Bootstrap admin**: The first Admin, created at startup from `TICKETING_BOOTSTRAP_ADMIN_EMAIL` and `TICKETING_BOOTSTRAP_ADMIN_PASSWORD` when the user table is empty. [§6.14](product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)

**Built-in prompt**: A default agent prompt shipped inside the application, one per ticket type plus the guardrails, with a release number (`BuiltInVersion`). Instance defaults nobody edited follow new releases automatically. What each type asks for is in [§13.10](product/01-refined-spec.md#1310-default-prompts). [§13.3](product/01-refined-spec.md#133-domain-model)

**Bug**: Ticket type for a defect. Severity is shown prominently for bugs. Bugs can be created from a failed regression item. [§3](product/01-refined-spec.md#3-enumerations), [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Bug draft**: The pre-filled bug the server builds from a failed regression item's snapshot (title, templated repro steps, Severity Major, Priority High, session version, label `regression`). The create-bug dialog, REST and MCP all start from it (D-70). [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Canvas**: A diagram doc drawn in the visual editor (Excalidraw): shapes, bound arrows, text and free drawing. Its source is Excalidraw JSON, checked on every publish (no images, at most 10 000 elements). [§12.13](product/01-refined-spec.md#1213-canvas-diagrams-web-mcp)

**Canvas outline**: The text of a Canvas diagram that the server extracts from its Excalidraw JSON on publish: labels in reading order plus connector relations such as `API → DB (SQL)`. It feeds search and MCP `get_doc` (D-110, D-124). [ADR 0014](adr/0014-diagram-editor-and-pdf-pipeline.md)

**Canvas snapshot**: The light SVG picture of one Canvas diagram version (fonts inlined), sent by the editor on publish, or stored once by the first writer who opens a version written over MCP. The reader, page embeds, history and the PDF show it; dark mode inverts it with CSS (D-110, D-124). [§12.13](product/01-refined-spec.md#1213-canvas-diagrams-web-mcp)

**Carry-over**: Moving a board's unfinished tickets elsewhere when it is archived: to their project backlogs (top) or to another non-archived board. [§6.4](product/01-refined-spec.md#64-backlog-and-boards)

**Channel**: See Write channel.

**Checklist item**: One first step on the getting-started checklist, the card on My work (for example "Create a ticket"). It ticks itself off from real data computed on the server, whichever channel the action came through. Items are shown by audience: write items only to users who can write in at least one readable project, Owner items to project owners, Admin items to Admins; the "Connect an AI agent" items are optional. [§14.3](product/01-refined-spec.md#143-getting-started-checklist)

**Child**: See Parent / child.

**Collapsing (notifications)**: Merging rapid changes into one notification: an event by the same actor on the same ticket (or regression session, or doc) within 5 minutes of the first event of an unread notification raises its event count instead of adding a row; the highest-ranked kind becomes the headline (D-94). [§6.16](product/01-refined-spec.md#616-in-app-notifications-i-30-d-94)

**Comment**: Markdown text on a ticket, or below a page or diagram (doc comment, D-117), listed oldest first. Authors edit or delete their own; Owners delete any; a deleted comment leaves a placeholder. [§4.7](product/01-refined-spec.md#47-comment), [§6.9](product/01-refined-spec.md#69-comments)

**Conflict view (docs)**: What the page editor shows when my edit and a version published meanwhile change the same or touching lines: theirs and mine side by side, with Keep editing on latest, Overwrite with mine and Discard mine. Edits to different parts merge on their own (D-116). [§12.8](product/01-refined-spec.md#128-reading-and-editing-pages-web)

**Connect an AI agent guide**: The three-step panel on Profile → Access tokens that walks a user through connecting Claude Code: create a token, copy the `claude mcp add` command, and a connection check that turns green once the token has been used. Opened from the Help menu, the palette, the empty tokens page and the checklist's agent items (D-141). [§14.8](product/01-refined-spec.md#148-agent-onboarding)

**Container**: Where a ticket sits: its project backlog or exactly one board. Rank orders tickets within a container. [§6.4](product/01-refined-spec.md#64-backlog-and-boards), [§6.6](product/01-refined-spec.md#66-ranking)

**Critical path**: In the sub-tickets graph, the longest chain of open tickets connected by `Blocks` links, counted in tickets. Links that close a cycle are ignored. [D-95](decisions.md)

**Deactivation**: The only way to remove a user. It blocks login, revokes all their PATs and hides them from pickers, while their name stays on history as "Name (deactivated)" (D-12). [§4.1](product/01-refined-spec.md#41-user)

**Delegated run comment**: The one comment a delegated agent ends with, starting `Delegated run · <Type> v<n> / <D|C>` so it names the prompt template and version that ran. [§13.10](product/01-refined-spec.md#1310-default-prompts)

**Delete group (docs)**: The docs deleted by one delete: a doc, or a folder with its whole subtree. Its members share `DeletedRootId`; restore and the trash work on whole groups. [§12.5](product/01-refined-spec.md#125-delete-and-restore)

**Demo data**: The believable workspace the demo seeder writes into an empty database for development and demos (`TICKETING_SEED_DEMO`, D-85): users, three projects with twelve weeks of ticket history, boards, test cases, regression sessions, feature flags and a docs tree per project (D-128). Never used on a real installation.

**Destructive MCP tool**: A tool that deletes, unlinks, cancels or archives (`delete_ticket`, `delete_comment`, `unlink_tickets`, `cancel_regression_session`, `archive_board`, `delete_doc`, `delete_doc_comment`). It carries `destructiveHint` and `anthropic/requiresUserInteraction`, so Claude Code asks the user before every call. [§9.1](product/01-refined-spec.md#91-transport-and-auth), [D-102](decisions.md)

**Diagram (doc)**: A doc whose content is a drawing: `Mermaid` (text source) or `Canvas` (Excalidraw JSON with a picture per version). It has versions, comments and a PDF export like a page, and pages embed it with `![caption](KEY)`.

**Diagram embed**: `![caption](WEB-D-7)` in a page: the diagram doc rendered read-only in a figure with its title and caption. An unreadable or deleted diagram shows "Diagram not available". The diagram is drawn by its format's renderer when it scrolls into view ([§12.12](product/01-refined-spec.md#1212-mermaid-diagrams-web-mcp)).

**Doc**: A node of a project's docs tree: a `Folder`, a markdown `Page` or a `Diagram` (`Mermaid` or `Canvas`). Pages and diagrams have versions; folders hold other docs, up to 6 levels deep. [§12](product/01-refined-spec.md#12-docs)

**Doc draft**: A user's private, unpublished edit of a page or diagram, autosaved by the editor. Others only see that the user is editing. Publishing creates a version and deletes the draft. [§12.4](product/01-refined-spec.md#124-content-versions-and-drafts)

**Doc key**: `{ProjectKey}-D-{n}`, for example `WEB-D-12`, for every kind of doc. Numbered per project from one counter, never reused, case-insensitive on lookup. [§12.1](product/01-refined-spec.md#121-model-and-keys)

**Doc path**: A doc's titles from the root joined by `/` (`Architecture/ADRs/0001 Use Postgres`), case-insensitive; `/` inside a title is written `\/`. Unique because titles are unique within a folder. [§12.1](product/01-refined-spec.md#121-model-and-keys)

**Doc reference**: An entry of the index of ticket and doc keys a doc's latest content names (`doc_references`), rebuilt on every publish and filtered for each reader. It feeds the ticket chips, the "Tickets mentioned" and "Linked from" sections, a ticket's "Docs mentioning this ticket" and the `mentions` search filter.

**Doc search**: Search over doc titles, the latest published content and Canvas labels in readable projects (never drafts or deleted docs), by relevance or newest first. Each result carries a snippet. [§12.7](product/01-refined-spec.md#127-search)

**Doc version**: An immutable full snapshot of a page or diagram's title and content, numbered 1..n, created by every publish. `baseVersion` names the version an edit started from. [§12.4](product/01-refined-spec.md#124-content-versions-and-drafts)

**Doc history**: A doc's versions merged with its other activity (renames, moves, deletes, attachments, comments), newest first: the History panel (`H`) and MCP `get_doc_history`. Any two versions can be compared as a line diff with word highlights. [§12.10](product/01-refined-spec.md#1210-version-history), D-118

**Effective access**: A user's resulting role on a project, computed from global role, membership and visibility. It decides every project permission. [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Epic**: Ticket type for a large body of work. An epic cannot have a parent; it is usually the top of a hierarchy. [§6.3](product/01-refined-spec.md#63-parent-and-child)

**Execution mode**: Snapshot of a test case's status (`Manual` or `Automatic`) taken when a regression session starts. It decides whether the item waits for a tester or is auto-passed. [§4.11](product/01-refined-spec.md#411-regressionsessionitem)

**Expected version**: The row version a client last saw, sent as `If-Match` (REST) or `expectedVersion` (MCP). A stale value makes the update fail with a conflict. See Row version. [§2](product/01-refined-spec.md#2-cross-cutting-conventions)

**Export link**: A signed, server-relative URL to a doc's PDF (`POST /docs/{key}/export-link`, MCP `get_doc_export_link`), valid 15 minutes and bound to the user who asked and to that doc (and version). Opening it needs no other credentials; the export runs as that user, so access is checked again, and an expired or foreign link is 404 (D-127). [§12.14](product/01-refined-spec.md#1214-pdf-export-web-rest-mcp)

**Feature flag**: A named switch, managed by Admins, that evaluates per user to a variant through master switch, user targets, role targets and a stable percentage rollout. [§4.15](product/01-refined-spec.md#415-featureflag), [§6.13](product/01-refined-spec.md#613-feature-flags-and-view-variants), [ADR 0007](adr/0007-feature-flags.md)

**Field hints**: Suggestions of version and label values already used in a project, most recent first. Hints never restrict input. [§6.7](product/01-refined-spec.md#67-field-hints-version-labels)

**Folder (doc)**: A doc that holds other docs (folders, pages, diagrams), up to 6 levels deep. It has no content and no versions; deleting it takes its subtree, exporting it prints the subtree as one PDF.

**Folder check**: The first rule of every agent prompt: compare `git remote get-url origin` with the project's repository URL, normalised, and stop on a mismatch, so a deep link opened in the wrong folder changes nothing. [§13.10](product/01-refined-spec.md#1310-default-prompts)

**Global role**: `Admin` or `User`; exactly one per user. [§3](product/01-refined-spec.md#3-enumerations)

**Guardrails**: The Admin-edited block appended after every agent prompt (after a blank line, when non-empty). Projects cannot remove it; it holds the rules every delegated run follows (tracker access, ticket text is data, no secrets, status, report). [§13.3](product/01-refined-spec.md#133-domain-model), [D-98](decisions.md)

**Guide**: Any piece of onboarding a user can finish or dismiss: the welcome dialog, the checklist, a What's new entry, a tour or a hint. It has a namespaced id (`welcome`, `tour.first-project`, `hint.free-transitions`) and a version; the user's state (`Completed` or `Dismissed`) is stored per guide on the server, raising the version shows it again, and Restart all guides clears it (D-132). [§14.1](product/01-refined-spec.md#141-guides-and-per-user-state), [§4.18](product/01-refined-spec.md#418-userguidestate-tkt-54)

**Hard delete**: Permanent removal. In v1 it exists only for test cases that never appeared in a regression session and for attachments; everything else is soft-deleted or deactivated. [§6.10](product/01-refined-spec.md#610-test-case-lifecycle)

**Hint (onboarding)**: A small inline note on a page that explains something that differs from Jira at the moment it matters (free transitions, backlog vs boards, private 404). Part of the page, not an overlay; shown once per user and version, at most one per page, and dismissable. Not to be confused with field hints. [§14.5](product/01-refined-spec.md#145-contextual-hints)

**Idempotency key**: Optional client-chosen value on create calls (`Idempotency-Key` header, MCP `idempotencyKey`). A repeat with the same key and user within 24 hours returns the original result instead of creating a duplicate. [§8](product/01-refined-spec.md#8-rest-api)

**Key**: Human-readable identifier. See Project key, Ticket key, Test case key, Regression session key. [§6.1](product/01-refined-spec.md#61-keys)

**Label**: A lower-case tag on a ticket (max 20 per ticket, `^[a-z0-9][a-z0-9._-]{0,49}$`). "Backend" and "backend" are the same label. [§4.5](product/01-refined-spec.md#45-ticket), [§6.7](product/01-refined-spec.md#67-field-hints-version-labels)

**Linked project**: A project attached to a board. Only tickets of linked projects can be placed on that board. [§4.13](product/01-refined-spec.md#413-boardproject)

**MCP (Model Context Protocol)**: The protocol LLM clients such as Claude Code use to call tools. Ticketing serves it at `/mcp` over Streamable HTTP, authenticated with a PAT, exposing the same use cases as REST. [§9](product/01-refined-spec.md#9-mcp-server), [ADR 0004](adr/0004-in-process-mcp-server.md)

**Lockout**: After 5 failed logins in a row from one client address, the account is locked for that address for 15 minutes (`LoginThrottle.LockedUntil`, D-74). It looks like a wrong password to the caller. [§6.14](product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)

**Merge policy**: Per project, how far a delegated run may go: `Review` (push a branch, set Review, a person merges; default) or `MergeWhenVerified` (also merge back into the default branch once the checks pass). It picks the sentence the `{{finish}}` placeholder renders. [§13.3](product/01-refined-spec.md#133-domain-model)

**Member**: Project role that can read and write tickets, test cases and regressions, but not delete tickets, moderate comments or manage the project. Every signed-in user has Member access to a public project. [§5.3](product/01-refined-spec.md#53-project-actions)

**My work**: Page listing the current user's open tickets across projects, their waiting regression items and the open tickets they watch. [§6.8](product/01-refined-spec.md#68-search-lists-and-export)

**Mention**: A reference to a user in a ticket description, a ticket or doc comment (D-162), written with the `@` people picker or as `@email`, stored as `@[Name](user:<id>)` so it survives renames. Only active users who can read the project can be newly mentioned; a new mention notifies them once and makes them a watcher, and readers see it as a chip with the current name (others see plain text) (D-96). [§6.9](product/01-refined-spec.md#69-comments)

**Mermaid diagram**: Diagram written as Mermaid text, either inline in markdown (a ```` ```mermaid ```` block, in pages, tickets and comments) or as a diagram doc with its own view and editor. Rendered in the browser with strict security; the supported types are flowchart, sequence, class, state (v2), ER, gantt and mind map. [§12.12](product/01-refined-spec.md#1212-mermaid-diagrams-web-mcp), D-121

**Normalized repository URL**: The form two git remotes of one repository share: host and path in lower case without scheme, user, port or `.git` (`git.example.com/team/repo` for both `https://git.example.com/team/repo.git` and `git@git.example.com:team/repo`). Agents compare their clone's remote with it. [§13.3](product/01-refined-spec.md#133-domain-model), [D-99](decisions.md)

**Notification**: An in-app message to one user about a change someone else made: assigned to them (ticket or regression item), mentioned, or a comment, status change, priority raised to High/Highest, move or deletion on a ticket they watch, or a new comment on a page or diagram they watch (D-161). Created in the same transaction as the change, shown under the bell, listed only while the user can read the project, purged after 90 days (D-94). See Collapsing and Notification preferences. [§6.16](product/01-refined-spec.md#616-in-app-notifications-i-30-d-94)

**Notification preferences**: The notification kinds and projects a user muted (Profile → Notifications, D-160). A muted kind never notifies; a muted project silences activity there, while the direct kinds (mentions and assignments) still come through. Applied when a notification would be created. [§6.16](product/01-refined-spec.md#616-in-app-notifications-i-30-d-94)

**Open**: A ticket whose status category is not `Done`. Used in dashboards and filters. [§3](product/01-refined-spec.md#3-enumerations)

**Owner**: Project role with full control of a project: settings, members, archive, ticket deletion, comment moderation, assigning regression items to others. Admins act as Owner on every project. A non-archived project always has at least one active Owner. [§4.3](product/01-refined-spec.md#43-project), [§5.3](product/01-refined-spec.md#53-project-actions)

**Page (doc)**: A markdown doc: GFM with callouts, tables, code, ticket chips, doc links and diagram embeds, edited in a private draft and published as a new version. Attachments (images, files) belong to pages only.

**Parent / child**: Hierarchy between tickets of the same project via `ParentId`: at most 3 levels, no cycles, epics have no parent. Children are independent of their parent's status and placement. [§6.3](product/01-refined-spec.md#63-parent-and-child)

**PAT (personal access token)**: A secret (`tkt_` + 40 base62 characters) a user creates to call REST or MCP as themselves. It has a scope and a mandatory expiry; only its SHA-256 hash is stored and it is shown once. [§4.2](product/01-refined-spec.md#42-personalaccesstoken), [§6.12](product/01-refined-spec.md#612-pat-lifecycle), [ADR 0003](adr/0003-authentication-cookie-and-pat.md)

**Presence (docs)**: "Jane is editing": the other users whose draft of a doc changed in the last 10 minutes, shown in the reader and the editor and refreshed every 30 s. It never reveals the draft itself. [§12.8](product/01-refined-spec.md#128-reading-and-editing-pages-web)

**Print bundle**: The offline page the PDF renderer prints: the SPA's markdown and Mermaid renderer built into one script, print styles from the design tokens, and a JSON block with the documents the exporting user may read. It needs no network and calls nothing back (D-111). [ADR 0014](adr/0014-diagram-editor-and-pdf-pipeline.md)

**Priority**: How soon a ticket should be worked on: `Highest`, `High`, `Medium` (default), `Low`, `Lowest`. Required on every ticket. [§3](product/01-refined-spec.md#3-enumerations)

**Private project**: Visible only to its members and Admins. To anyone else it does not exist: the API answers 404 and it never appears in search, boards, hints or MCP. Default visibility (D-32). [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Project**: A container for tickets, test cases and regression sessions, with its own members, backlog and dashboard. Any user can create one. [§4.3](product/01-refined-spec.md#43-project)

**Project key**: Short immutable code (`^[A-Z][A-Z0-9]{1,9}$`, for example `WEB`) that prefixes all keys in the project. Unique forever, including archived and deleted projects (D-10). [§4.3](product/01-refined-spec.md#43-project)

**Project role**: `Owner`, `Member` or `Viewer`; exactly one per membership. [§3](product/01-refined-spec.md#3-enumerations), [§4.4](product/01-refined-spec.md#44-projectmember)

**Public project**: A project every signed-in user can read and write with Member access (D-02). Settings, membership and destructive actions stay with Owners. [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Public URL**: `TICKETING_PUBLIC_URL`, the instance's origin as users reach it. Agent prompts build ticket links from it; while it is unset agent delegation is off for everyone. [§13.2](product/01-refined-spec.md#132-feature-flag)

**Publish (doc)**: Turning content into the doc's next version: the editor's Publish (`Ctrl S`), every MCP and REST content write, and a version restore. Publishing drops the publisher's draft, re-indexes references and makes the content visible to every reader.

**Quick jump**: `Ctrl+K` or `/`: type a ticket, test case, regression session or doc key to open it, or text to list the 10 best ticket title matches and, below them, the 5 best docs with a snippet, across readable projects. With an empty query the palette lists recently viewed docs. [§6.8](product/01-refined-spec.md#68-search-lists-and-export), [§12.7](product/01-refined-spec.md#127-search)

**Rank**: Hidden fractional-index string that orders tickets within their container; compared byte-wise (`COLLATE "C"`). [§6.6](product/01-refined-spec.md#66-ranking), [ADR 0010](adr/0010-fractional-index-ranking.md)

**Ready ticket**: An open ticket that no open ticket blocks, so work on it can start. Shown green in the sub-tickets graph. [D-95](decisions.md)

**Recent docs**: The project's most recently updated pages and diagrams: "Recently updated" on the Docs home (10), the palette's `p:` list, and dashboard widget 13 with the 5 latest and the total (`get_project_stats.recentDocs`).

**Regression bug**: A ticket created from a failed regression session item (the item's `BugTicketId`). The dashboard counts the open ones. [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Regression item**: One test case inside a regression session: a snapshot of the case plus its own status, assignee, result note and optional bug. [§4.11](product/01-refined-spec.md#411-regressionsessionitem)

**Regression item status**: `WaitingForExecution`, `Passed`, `Failed` (needs a result note), `Skipped`. [§3](product/01-refined-spec.md#3-enumerations)

**Regression session**: One run of a project's ready test cases, usually for a version. It starts with all non-archived `Manual` and `Automatic` cases and ends `Completed` or `Cancelled`. Several can run in parallel (D-22). [§4.10](product/01-refined-spec.md#410-regressionsession), [§6.11](product/01-refined-spec.md#611-regression-session-lifecycle)

**Regression session key**: `{ProjectKey}-R-{n}`, for example `WEB-R-3`. [§6.1](product/01-refined-spec.md#61-keys)

**Reporter**: The user who reported a ticket; defaults to its creator and can be changed. [§4.5](product/01-refined-spec.md#45-ticket)

**Resolution**: Why a ticket is done: `Done`, `WontDo`, `Duplicate`, `CannotReproduce`. Set if and only if the status is `Done`. [§3](product/01-refined-spec.md#3-enumerations), [§6.2](product/01-refined-spec.md#62-ticket-lifecycle)

**Resolved prompt**: The prompt for one ticket after resolution: the project's template for its type (or the instance default), rendered, followed by the guardrails. Read with `GET /tickets/{key}/agent-prompt` or MCP `get_agent_prompt`. [§13.5](product/01-refined-spec.md#135-resolving-the-prompt-for-a-ticket)

**Restore (doc version)**: Publishing an older version's title and content again as a new version with `restoredFrom` set, so nothing is lost; not the same as restoring a deleted doc from the trash. [§12.10](product/01-refined-spec.md#1210-version-history)

**Row version**: PostgreSQL `xmin` exposed as `rowVersion`, used for optimistic concurrency on every mutable aggregate. [§2](product/01-refined-spec.md#2-cross-cutting-conventions), [ADR 0005](adr/0005-postgresql-and-ef-core.md)

**Scope (PAT)**: `ReadOnly` or `ReadWrite`. A token acts with its user's current permissions intersected with its scope; no token can manage tokens, passwords, users or flags. [§5.5](product/01-refined-spec.md#55-pat-scope)

**Server instructions (MCP)**: The short primer on Ticketing's model that the MCP server sends every client on `initialize`: whoami first, keys, free transitions, backlog vs boards, not found for private projects, idempotency keys. One constant, mirrored verbatim in `docs/mcp.md` (D-141). [§14.8](product/01-refined-spec.md#148-agent-onboarding)

**Set-password link**: One-time link an Admin hands to a user so they can set a password: valid 72 hours for a new user, 24 hours for a reset. No email is sent in v1. [§6.14](product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01)

**Severity**: Impact of a problem: `Blocker`, `Critical`, `Major`, `Minor`, `Trivial`. Optional on every ticket, prominent on bugs (D-26). [§3](product/01-refined-spec.md#3-enumerations)

**Shared achievement**: An achievement its owner chose to show to others. Every signed-in user can see its name, icon and tier, never when it was earned. Unshared achievements stay visible only to their owner (D-144).

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

**Ticket chip**: How a doc shows a mentioned ticket the reader may see: the status ring and the key, with the title and status on hover. Unreadable tickets show as plain text.

**Ticket key**: `{ProjectKey}-{n}`, for example `WEB-42`. Numbers come from a per-project counter, are never reused and are looked up case-insensitively. [§4.5](product/01-refined-spec.md#45-ticket), [§6.1](product/01-refined-spec.md#61-keys)

**Ticket link**: A typed relation between two tickets, possibly in different projects: `Blocks` / is blocked by, `RelatesTo`, `Duplicates` / is duplicated by. Parent/child is not a link. [§4.6](product/01-refined-spec.md#46-ticketlink-i-05)

**Ticket type**: `Epic`, `UserStory`, `Technical`, `Spike` or `Bug`. Changeable, subject to the parent/child rules. [§3](product/01-refined-spec.md#3-enumerations)

**Tour**: A short guided sequence of steps on one view, each a popover pointing at part of the page under a spotlight. Keyed by view id, never by variant; started from the welcome dialog, an empty state, the Help menu or the palette, never by itself. Steps the user may not perform are left out (D-131). Its guide id is `tour.<viewId>`; "Tour of this page" in the Help menu and a `help.tour.<viewId>` palette command start it (D-136). [§14.4](product/01-refined-spec.md#144-tours-and-the-anchor-rule)

**Tour anchor**: A stable id on a page element (`tkTourAnchor="backlog.quick-create"`, rendered as `data-tour`) that a tour step points at, separate from `data-testid`. Every variant of a view must expose the same anchor ids (D-131, extending ADR 0008), and an e2e spec fails when one disappears. [§14.4](product/01-refined-spec.md#144-tours-and-the-anchor-rule)

**User**: (1) A person with an account. (2) The non-admin global role, which can create projects and boards and manage their own tokens. [§4.1](product/01-refined-spec.md#41-user), [§5.2](product/01-refined-spec.md#52-global-actions)

**User story**: Ticket type (`UserStory`) for a user-facing requirement. [§3](product/01-refined-spec.md#3-enumerations)

**Variant**: The string a feature flag evaluates to for a user. In v1 always `on` or `off`; a string so A/B tests can add variants later (D-14). [§6.13](product/01-refined-spec.md#613-feature-flags-and-view-variants)

**Version**: Free text (max 50 characters, case-sensitive) naming the release a ticket or regression session belongs to. [§4.5](product/01-refined-spec.md#45-ticket), [§6.7](product/01-refined-spec.md#67-field-hints-version-labels)

**View registry**: Frontend map from view id (for example `ticket-detail`) to the component variants that render it. Every routed page resolves through it, so an A/B variant can be added later without changing routes (D-14). [§6.13](product/01-refined-spec.md#613-feature-flags-and-view-variants), [ADR 0008](adr/0008-ab-ready-views.md)

**Viewer**: Project role with read-only access to a private project. It has no effect on a public project, where everyone has Member access (D-16). [§5.1](product/01-refined-spec.md#51-effective-project-access)

**Visibility**: `Private` (default) or `Public`; decides who can access a project without membership. [§3](product/01-refined-spec.md#3-enumerations)

**Walkthrough**: A tour that spans several views and advances only when the user really does each action, never on Next. The one walkthrough is "Your first project" (`tour.first-project`): create a private project, a ticket, a board, place the ticket and end on the dashboard. It pauses behind a "Continue the walkthrough" pill when the user navigates away and resumes from real data, so nothing is created twice. Its steps are **action steps** (`advanceWhen`): non-modal, shortcuts live, done when a condition read from real data holds (D-142). [§14.4](product/01-refined-spec.md#144-tours-and-the-anchor-rule)

**Watcher**: A user who follows a ticket, page or diagram. Anyone who can read it may watch it; on tickets the reporter, the assignee (on each assignment), commenters and newly mentioned users start watching automatically, on pages and diagrams the creator and commenters (D-161). Only active watchers who can still read the project are shown or notified; the others stay stored but hidden (D-93). [§6.15](product/01-refined-spec.md#615-watchers-i-32-d-93)

**Welcome dialog**: The first-run dialog (guide `welcome`), opened by itself while the user has no `welcome` row: three cards for the user's role (Admins get "Set up your instance" first) and the actions Take the tour and Show me the checklist. Any close records it, so it is shown once (D-140). [§14.2](product/01-refined-spec.md#142-welcome-and-whats-new)

**What's new entry**: A highlight of new features, authored in code under a date id such as `2026-11` (guide `whats-new.2026-11`). Opened by itself once per user (oldest unseen first, at most one auto-shown dialog per browser session) and reopened from Help → What's new; an entry whose month starts before the user's account was created counts as seen (D-140). [§14.2](product/01-refined-spec.md#142-welcome-and-whats-new)

**Write channel**: How a write arrived: `Web` (browser session), `Api` (PAT over REST) or `Mcp` (PAT over MCP). Recorded on every activity entry. [§2](product/01-refined-spec.md#2-cross-cutting-conventions)
