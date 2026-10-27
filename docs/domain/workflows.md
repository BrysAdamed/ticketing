# Domain workflows

The key workflows of Ticketing as state and sequence diagrams. The [refined spec](../product/01-refined-spec.md) is normative; this document illustrates it and links each workflow to its section. Terms are defined in the [glossary](../glossary.md). Technical mechanics are in the [ADRs](../adr/README.md).

Every write described below runs inside one application handler, in one database transaction, and records activity entries with the caller's write channel (`Web`, `Api` or `Mcp`) ([ADR 0002](../adr/0002-modular-monolith-and-layering.md)). The diagrams leave out the generic steps (authentication, effective-access check, validation, `If-Match` concurrency check) unless they matter to the flow.

## Contents

1. [Ticket lifecycle and status side effects](#1-ticket-lifecycle-and-status-side-effects)
2. [Parent and child rules](#2-parent-and-child-rules)
3. [Backlog and board moves](#3-backlog-and-board-moves)
4. [Test case lifecycle](#4-test-case-lifecycle)
5. [Regression session lifecycle](#5-regression-session-lifecycle)
6. [PAT lifecycle and authentication](#6-pat-lifecycle-and-authentication)
7. [User onboarding](#7-user-onboarding)
8. [Feature flag evaluation and view variants](#8-feature-flag-evaluation-and-view-variants)
9. [MCP request flow](#9-mcp-request-flow)
10. [Attachment upload](#10-attachment-upload)

## 1. Ticket lifecycle and status side effects

Spec: [§6.2](../product/01-refined-spec.md#62-ticket-lifecycle), D-05, D-33.

Status transitions are free: any status may move to any other. The diagram groups the statuses by status category; the arrows between categories are the ones with side effects.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Open: create (status ToDo)
    state Open {
        [*] --> ToDo
        state InProgressCategory {
            InProgress
            OnHold
            Review
            ReadyForTesting
            Testing
            ReadyForDeploy
        }
    }
    Open --> Done: enter Done
    Done --> Open: leave Done (reopen)
    Open --> Deleted: soft delete
    Done --> Deleted: soft delete
    Deleted --> [*]
    note right of Open
        Any status can move to any other.
        Moves inside Open only set StatusChangedAt.
    end note
```

What a status change does:

```mermaid
flowchart TD
    A["Status change requested"] --> B["StatusChangedAt = now"]
    B --> C{"New status is Done?"}
    C -- yes --> D["ResolvedAt = now<br/>Resolution = given value, or Done"]
    C -- no --> E{"Old status was Done?"}
    E -- no --> Z["Save, write ActivityEntry per changed field"]
    E -- yes --> F["ResolvedAt = null<br/>Resolution = null"]
    F --> G{"Ticket sits on an archived board?"}
    G -- no --> Z
    G -- yes --> H["Move to top of its project backlog<br/>(BoardId = null, new Rank, ticket.moved)"]
    H --> Z
    D --> Z
```

- A `Resolution` sent with a status other than `Done` is a validation error: resolution is set if and only if the status is `Done`.
- Moving a ticket to a specific board column changes its status as part of the move ([section 3](#3-backlog-and-board-moves)); the same side effects apply.
- One PATCH that changes several fields writes one `ticket.field.changed` entry per changed field, all with the same `OccurredAt`. Fields sent with their current value write nothing and do not bump `UpdatedAt`. A reopened ticket that leaves an archived board writes `ticket.moved` (field `boardId`).
- Opening a deleted ticket answers 404 `ticket.deleted` with "WEB-42 was deleted by X on date" (D-49).

Deleting a ticket (Owner only):

```mermaid
flowchart TD
    A["Owner deletes WEB-42"] --> B{"Has non-deleted children?"}
    B -- yes --> X["Rejected: ticket.hasChildren<br/>reparent or delete the children first"]
    B -- no --> C["DeletedAt, DeletedById set"]
    C --> D["BoardId = null"]
    D --> E["All links removed"]
    E --> F["Test cases pointing to it: TicketId = null"]
    F --> G["Regression items keep BugTicketId<br/>(rendered as deleted)"]
    G --> H["Hidden from every list, search and board<br/>key WEB-42 stays reserved"]
```

## 2. Parent and child rules

Spec: [§6.3](../product/01-refined-spec.md#63-parent-and-child), D-06.

The same checks run when a parent is set (create or update) and when a ticket's type changes. Depth counts levels, so Epic > UserStory > Technical is depth 3, the maximum.

```mermaid
flowchart TD
    A["Set ParentId of ticket T to P"] --> B{"P is null?"}
    B -- yes --> OK["Accepted: T becomes top level"]
    B -- no --> C{"P exists, not deleted,<br/>readable by the caller?"}
    C -- no --> NF["Rejected: not found"]
    C -- yes --> D{"P in the same project as T?"}
    D -- no --> R1["Rejected: parent must be in the same project"]
    D -- yes --> E{"T is an Epic?"}
    E -- yes --> R2["Rejected: an Epic cannot have a parent"]
    E -- no --> F{"P is T, or a descendant of T?"}
    F -- yes --> R3["Rejected: ticket.parent.cycle"]
    F -- no --> G{"depth of P plus height of T's subtree exceeds 3?"}
    G -- yes --> R4["Rejected: ticket.parent.depth"]
    G -- no --> OK2["Accepted"]
```

Type changes:

```mermaid
flowchart LR
    A["Change type of T"] --> B{"New type is Epic?"}
    B -- yes --> C{"T has a parent?"}
    C -- yes --> X["Rejected"]
    C -- no --> OK["Accepted"]
    B -- no --> D{"Depth rule still holds<br/>for T's subtree?"}
    D -- yes --> OK
    D -- no --> Y["Rejected: ticket.parent.depth"]
```

- Children are independent of their parent: status, board and backlog placement never roll up or cascade.
- The ticket view lists direct children with a progress bar by status category.

## 3. Backlog and board moves

Spec: [§6.4](../product/01-refined-spec.md#64-backlog-and-boards), [§6.6](../product/01-refined-spec.md#66-ranking), D-09, D-30. Ranking mechanics: [ADR 0010](../adr/0010-fractional-index-ranking.md).

A ticket is always in exactly one container: its project backlog or one board.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Backlog: create (bottom)
    [*] --> Board: create with a board (bottom of column)
    Backlog --> Board: place on board
    Board --> Backlog: send back (top)
    Board --> Board: move to another board
    Board --> Backlog: project unlinked or archived, board deleted (top)
    Board --> Backlog: board archived, carry-over to backlogs (non-Done, top)
    Board --> ArchivedBoard: board archived (Done tickets stay)
    ArchivedBoard --> Backlog: ticket leaves Done (top)
    ArchivedBoard --> Backlog: archived board deleted (top)
    ArchivedBoard --> Board: board unarchived
```

Default positions:

| Event | Position |
| --- | --- |
| New ticket in the backlog | Bottom of the backlog |
| Ticket sent back to the backlog (by a user or by a cascade) | Top of the backlog; several tickets keep their relative order |
| Ticket placed on a board without a position | Bottom of its status column |
| Ticket dropped between two cards | Between them |

A move, including a multi-select move:

```mermaid
sequenceDiagram
    autonumber
    actor U as User
    participant SPA as Angular SPA
    participant API as Move handler
    participant DB as PostgreSQL
    U->>SPA: Drag WEB-42 and WEB-43 to board B, column Review, before WEB-7
    SPA->>SPA: Reorder optimistically
    SPA->>API: move keys, target B, status Review, beforeKey WEB-7
    API->>API: Write access to each ticket's project?
    API->>API: Board B links each project and is not archived?
    API->>DB: Lock source and target container rows (in id order)
    API->>DB: Read neighbours, generate keys between them
    opt Generated key longer than 64 characters
        API->>DB: Rebalance the target container in the same transaction
    end
    API->>DB: Update BoardId, Rank, Status (with status side effects)
    API->>DB: ActivityEntry ticket.moved per ticket, plus status field changes
    API-->>SPA: Moved ticket summaries
    alt Error (403, 404, 409, validation)
        SPA->>SPA: Roll back the optimistic reorder, show the error
    end
```

- Status changes on a move only when the move targets a specific column.
- Reordering inside the backlog (D-48) moves the selected tickets as one block, in the order sent, right before or after another backlog ticket or to the top or bottom. The neighbours are read under the container lock, and the block gets consecutive ranks; a too-long key rebalances the backlog with free slots. Rank changes write no history.
- Placing on a board requires: the board links the ticket's project, the board is not archived, and the actor can write to the project.

Board archive with carry-over:

```mermaid
flowchart TD
    A["Board owner or Admin archives board B<br/>and picks a target: backlogs, or board T"] --> V{"T, if given, is not archived<br/>and is not B?"}
    V -- no --> X["Rejected"]
    V -- yes --> L["For each ticket on B"]
    L --> D{"Status is Done?"}
    D -- yes --> S["Stays on B as a record"]
    D -- no --> TB{"Target is a board T<br/>that links the ticket's project?"}
    TB -- yes --> MT["Move to T, bottom of its status column<br/>(relative order kept)"]
    TB -- no --> MB["Move to its project backlog top<br/>(relative order kept)"]
    S --> F["B.ArchivedAt set: read-only,<br/>listed under Archived boards"]
    MT --> F
    MB --> F
```

Other cascades:

- **Unlink a project from a board:** that project's tickets on the board go to the backlog top, keeping relative order. The UI confirms with the count.
- **Archive a project:** all its tickets leave all boards, archived boards included, and the project is unlinked from every board. The tickets go to the backlog top as one block, ordered board by board (oldest board first) and by board rank within a board (D-52). Each moved ticket gets a `ticket.moved` entry (`boardId` old → null) and each board a `board.project.unlinked` entry. Unarchiving does not relink boards.
- **Unarchive a project:** if no active Owner member is left (owners deactivated while it was archived), the acting Admin becomes an Owner (D-52).
- **Delete a project:** Admin only, archived only, web session only, confirmed by typing the key. Soft delete: the key stays reserved, the name becomes free (D-53).
- **Delete a board:** all its tickets, Done included, go to their backlogs (top); the board is soft-deleted.
- **Project becomes private:** its tickets stay on boards and simply disappear for users who lose access ([§6.5](../product/01-refined-spec.md#65-private-projects-on-shared-boards)).

Spec gap: board archive, unlink and delete move tickets of projects the acting board owner may not be able to read or write. The spec treats these as board actions, so the cascade does not check per-ticket write access. Confirm with the product owner.

## 4. Test case lifecycle

Spec: [§6.10](../product/01-refined-spec.md#610-test-case-lifecycle), [§4.9](../product/01-refined-spec.md#49-testcase), D-19, D-21.

Status and archive are independent: an archived case keeps its status.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Active: create (status New)
    state Active {
        direction LR
        [*] --> New
        New --> Manual: needs at least one step
        New --> Automatic
        Manual --> Automatic
        Automatic --> Manual: needs at least one step
        Manual --> New
        Automatic --> New
    }
    Active --> Archived: archive
    Archived --> Active: unarchive
    Active --> HardDeleted: delete (Owner, never used in a session)
    Archived --> HardDeleted: delete (Owner, never used in a session)
    HardDeleted --> [*]
```

| Status | Meaning | In a new regression session |
| --- | --- | --- |
| `New` | Not ready | Excluded |
| `Manual` | Executed by a person; at least one step | Item `WaitingForExecution` |
| `Automatic` | Covered by an automated test (`AutomationReference`) | Item `Passed` (auto-passed) |
| any, archived | Hidden by default | Excluded |

Editing a test case never changes running or completed sessions: they hold snapshots. A case that has appeared in a session can only be archived, not deleted.

## 5. Regression session lifecycle

Spec: [§6.11](../product/01-refined-spec.md#611-regression-session-lifecycle), [§4.10](../product/01-refined-spec.md#410-regressionsession), [§4.11](../product/01-refined-spec.md#411-regressionsessionitem), D-13, D-20 to D-25.

```mermaid
stateDiagram-v2
    direction LR
    [*] --> InProgress: start (at least one eligible case)
    InProgress --> Completed: complete (no item waiting)
    InProgress --> Completed: complete with skip remaining
    InProgress --> Cancelled: cancel (Owner or session starter)
    Completed --> [*]
    Cancelled --> [*]
    note right of Completed
        Session and items are immutable.
    end note
    note right of Cancelled
        Read-only, excluded from dashboard trends.
    end note
```

Items, while the session is `InProgress`:

```mermaid
stateDiagram-v2
    direction LR
    [*] --> WaitingForExecution: Manual case
    [*] --> Passed: Automatic case (auto-passed)
    WaitingForExecution --> Passed
    WaitingForExecution --> Failed: result note required
    WaitingForExecution --> Skipped
    Passed --> Failed
    Failed --> Passed
    note right of WaitingForExecution
        Any result can change to any other
        while the session is InProgress,
        including back to WaitingForExecution.
    end note
```

Starting a session:

```mermaid
sequenceDiagram
    autonumber
    actor U as User (write access)
    participant API as StartRegressionSession handler
    participant DB as PostgreSQL
    U->>API: Start session for WEB (name, version optional)
    API->>DB: Non-archived test cases with status Manual or Automatic
    alt None
        API-->>U: Rejected: regression.noEligibleCases
    else At least one
        API->>DB: UPDATE project SET next_regression_number ... RETURNING
        API->>DB: Insert session WEB-R-n, InProgress, default name "Regression yyyy-MM-dd"
        loop Each eligible case, by test case number
            API->>DB: Insert item with snapshot (title, preconditions, steps, expected result, automation reference, mode)
            Note over API,DB: Manual: WaitingForExecution<br/>Automatic: Passed, ExecutedById null, ExecutedAt = StartedAt
        end
        API-->>U: Session with summary
    end
```

Executing items and creating a bug from a failure:

```mermaid
sequenceDiagram
    autonumber
    actor T as Tester
    participant SPA as Angular SPA
    participant API as Regression handlers
    participant DB as PostgreSQL
    T->>SPA: Take item WEB-TC-7
    SPA->>API: take item (confirm first if assigned to someone else)
    API->>DB: AssigneeId = tester
    T->>SPA: Record Failed with note "Login button does nothing"
    SPA->>API: record result Failed, note
    API->>API: Session InProgress? Caller is the assignee (or item unassigned, then assign caller)?
    API->>DB: Status Failed, ResultNote, ExecutedAt, ExecutedById, ActivityEntry on the session
    API-->>SPA: Updated item
    SPA->>API: Get pre-filled bug draft for the item
    API-->>SPA: Draft built from the snapshot (title, description template, Severity Major, Priority High, version, label regression)
    SPA->>T: Create bug dialog (editable, can cancel)
    T->>SPA: Save
    SPA->>API: Create bug from item (with any edits)
    API->>DB: Item BugTicketId already set?
    alt Already has a bug
        API-->>SPA: Rejected, UI shows the existing bug link
    else No bug yet
        API->>DB: Allocate ticket number, insert Bug at backlog top
        API->>DB: Item BugTicketId = new bug
        opt Test case has a non-deleted ticket
            API->>DB: RelatesTo link between bug and that ticket
        end
        API->>DB: ActivityEntry ticket.created and session entry
        API-->>SPA: Bug summary (WEB-57)
    end
```

- The bug description follows the template in [§6.11](../product/01-refined-spec.md#611-regression-session-lifecycle). The server builds the draft, so the UI dialog, REST and MCP (`record_regression_result` with `createBug: true`, which records the result and creates the bug in one call) produce identical bugs.
- Owners can assign or unassign items for others; only the assignee records results.
- Bugs are created only while the session is `InProgress`. With `createBug`, the result and the bug are saved together or not at all (D-70).
- Item writes share-lock the session row; complete and cancel lock it exclusively, so no result lands on a completed session (D-71).

Completing a session:

```mermaid
flowchart TD
    A["Complete WEB-R-3"] --> B{"Any item WaitingForExecution?"}
    B -- no --> C["Status Completed, CompletedAt/By set"]
    B -- yes --> D{"Skip remaining requested?"}
    D -- no --> X["Rejected: items still waiting"]
    D -- yes --> E["Waiting items: Skipped,<br/>note 'Skipped at completion'"]
    E --> C
    C --> F["Session and items immutable"]
```

Session summary: total, passed (manual and auto split), failed, skipped, waiting, pass rate = passed / (passed + failed), bugs created.

## 6. PAT lifecycle and authentication

Spec: [§4.2](../product/01-refined-spec.md#42-personalaccesstoken), [§5.5](../product/01-refined-spec.md#55-pat-scope), [§6.12](../product/01-refined-spec.md#612-pat-lifecycle), D-37. Mechanics: [ADR 0003](../adr/0003-authentication-cookie-and-pat.md).

```mermaid
stateDiagram-v2
    direction LR
    [*] --> Active: create (secret shown once, hash stored)
    Active --> Expired: ExpiresAt passes
    Active --> Revoked: revoked by its user or an Admin
    Active --> Revoked: user deactivated
    Expired --> Purged: 90 days later
    Revoked --> Purged: 90 days later
    Purged --> [*]
    note right of Active
        Max 20 active per user.
        Expiry 7, 30, 90 (default) or 365 days,
        or a custom date within 365 days.
        Warning badge within 7 days of expiry.
    end note
```

Revoked tokens stay revoked, also after the user is reactivated. Creating, listing and revoking tokens needs a browser session: no PAT can manage PATs.

Authenticating a request:

```mermaid
sequenceDiagram
    autonumber
    participant C as Client (script, Claude Code, SPA)
    participant N as nginx
    participant S as Policy scheme
    participant P as PAT handler
    participant K as Cookie handler
    participant L as Rate limiter
    participant Z as Authorization
    participant H as Handler
    C->>N: Request
    N->>S: Proxy to API
    alt Authorization header is Bearer
        S->>P: Forward
        P->>P: Starts with tkt_? SHA-256 of the token
        P->>P: Hash found, not revoked, not expired, user active?
        alt Any check fails
            P-->>C: 401 with WWW-Authenticate Bearer (no detail)
        else Valid
            P->>P: Claims: user, role, token id, scope. LastUsedAt at most every 5 min
            P->>L: 600 requests per minute per token
            alt Over the limit
                L-->>C: 429 with Retry-After
            end
        end
    else No bearer header
        S->>K: Forward
        K->>K: Valid tkt_session cookie, active user, security stamp unchanged?
        Note over K: Unsafe methods also need X-XSRF-TOKEN matching the XSRF-TOKEN cookie, else 400
    end
    S->>Z: Endpoint policy
    alt ReadOnly token on a write, or any PAT on a cookie-only endpoint
        Z-->>C: 403
    else Allowed
        Z->>H: Run handler as the token's user (channel Api or Mcp)
        H-->>C: Result (private projects without access: 404)
    end
```

## 7. User onboarding

Spec: [§6.14](../product/01-refined-spec.md#614-user-and-authentication-lifecycle-d-01), [§4.1](../product/01-refined-spec.md#41-user), D-01, D-12, D-38, D-41.

On first start with an empty user table, the API creates the bootstrap Admin from `TICKETING_BOOTSTRAP_ADMIN_EMAIL` and `TICKETING_BOOTSTRAP_ADMIN_PASSWORD`, and refuses to start if they are missing. Every other account follows this flow:

```mermaid
sequenceDiagram
    autonumber
    actor A as Admin
    participant API as Ticketing API
    participant DB as PostgreSQL
    actor N as New user
    A->>API: Create user (email, display name, global role)
    API->>DB: Insert user, PasswordHash null
    API->>DB: SetPasswordTokenHash = SHA-256(one-time token), expires in 72 h
    API-->>A: Set-password link (shown once)
    A->>N: Hands over the link in person or by chat (no email in v1)
    N->>API: Open link, submit new password
    API->>DB: Token hash matches and not expired?
    alt Invalid or expired
        API-->>N: Link no longer valid, ask the Admin for a new one
    else Valid
        API->>API: Policy: 12 to 128 chars, not the email, not in the 10 000 most common
        API->>DB: PasswordHash set, token cleared, lockout lifted, SecurityStamp rotated (other sessions end)
        API-->>N: Password set
        N->>API: Sign in (email, password)
        API->>DB: Not locked, active, password verifies?
        API->>DB: FailedLoginCount = 0, LastLoginAt = now
        API-->>N: tkt_session cookie, XSRF-TOKEN cookie
    end
```

Account states:

```mermaid
stateDiagram-v2
    direction LR
    [*] --> AwaitingPassword: Admin creates user (72 h link)
    AwaitingPassword --> AwaitingPassword: Admin issues a new link
    AwaitingPassword --> Active: set password via link
    Active --> Locked: 5 failed logins
    Locked --> Active: 15 minutes pass
    Active --> Active: reset link used (24 h link), old password valid until then
    Active --> Deactivated: Admin deactivates
    AwaitingPassword --> Deactivated: Admin deactivates
    Deactivated --> Active: Admin reactivates
    note right of Deactivated
        Login blocked, PATs revoked, hidden from pickers.
        Blocked for the last active Admin (user.lastAdmin)
        and for the last Owner of a non-archived project
        (user.lastProjectOwner).
    end note
```

`AwaitingPassword` and `Locked` are not stored states: they follow from `PasswordHash` being null and from `LockedUntil` being in the future. A reactivated user who never set a password still needs a set-password link: deactivation clears a pending one.

Users change their own password with the current one. That rotates the security stamp: every other cookie session ends at its next request, and the current session is re-issued with the new stamp (D-55). Unknown, used, expired and deactivated users' links all give the same 404 (D-56).

## 8. Feature flag evaluation and view variants

Spec: [§6.13](../product/01-refined-spec.md#613-feature-flags-and-view-variants), [§4.15](../product/01-refined-spec.md#415-featureflag), D-14. Mechanics: [ADR 0007](../adr/0007-feature-flags.md), [ADR 0008](../adr/0008-ab-ready-views.md).

Evaluation for a signed-in user; the first match wins:

```mermaid
flowchart TD
    A["Evaluate flag K for user U"] --> B{"Flag K exists?"}
    B -- no --> OFF["off"]
    B -- yes --> C{"Enabled?"}
    C -- no --> OFF
    C -- yes --> D{"U.Id in TargetUserIds?"}
    D -- yes --> ON["on"]
    D -- no --> E{"U.GlobalRole in TargetRoles?"}
    E -- yes --> ON
    E -- no --> F["bucket = first 4 bytes of SHA-256('K:U.Id')<br/>as unsigned big-endian integer, mod 100"]
    F --> G{"bucket below RolloutPercentage?"}
    G -- yes --> ON
    G -- no --> OFF
```

The bucket is stable across restarts and identical in C# and TypeScript; the user id is the lower-case hyphenated GUID string.

From flags to a rendered page:

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant APP as Angular app
    participant API as API
    participant R as View registry
    participant X as Exposure tracker
    B->>APP: Start
    APP->>API: GET /api/v1/me/flags
    API-->>APP: flags, for example ticket-view.v2 = off
    APP->>APP: Store in flags signal (refresh on window focus if older than 5 min)
    B->>APP: Navigate to /tickets/WEB-42
    APP->>R: Resolve view ticket-detail
    R->>R: View names a flag? Read its variant
    alt Component registered for the variant
        R-->>APP: Lazy-load that component
    else Unknown variant or no flag
        R-->>APP: Lazy-load the default component
    end
    opt View names a flag
        R->>X: exposed(viewId, flagKey, variant)
    end
    APP->>B: Render view over the page's store
```

In v1 every view has only a `default` variant, so the registry always renders it; the flow above is the seam for later A/B tests.

## 9. MCP request flow

Spec: [§9](../product/01-refined-spec.md#9-mcp-server), D-36. Mechanics: [ADR 0004](../adr/0004-in-process-mcp-server.md).

Setup: the user creates a PAT in the web UI, copies the ready-made snippet, and runs `claude mcp add --transport http ticketing https://<host>/mcp --header "Authorization: Bearer tkt_..."`.

```mermaid
sequenceDiagram
    autonumber
    participant CC as Claude Code
    participant N as nginx
    participant AU as Auth (PAT only on /mcp)
    participant M as MCP endpoint (stateless)
    participant T as Tool class
    participant H as Application handler
    participant DB as PostgreSQL
    CC->>N: POST /mcp tools/list, Bearer tkt_...
    N->>AU: Proxy (no buffering, 300 s timeout)
    AU->>M: Authenticated as the token's user
    M-->>CC: Tools allowed by the token scope (ReadOnly hides write tools)
    CC->>N: POST /mcp tools/call update_ticket key WEB-42, status Review
    N->>AU: Proxy
    AU->>M: Authenticated, rate limit checked
    M->>T: Bind arguments, scope policy for write tools
    T->>H: UpdateTicket request (same handler as REST)
    H->>DB: Effective access, validation, domain rules, save
    H->>DB: ActivityEntry with channel Mcp
    alt Success
        H-->>T: Updated ticket
        T-->>CC: JSON result (ticket with rowVersion)
    else Application error
        H-->>T: Error code
        T-->>CC: isError true, code, message, hint
    end
```

- A browser cookie on `/mcp` gets `401`: MCP accepts PATs only.
- Every call is one HTTP request; there is no MCP session to keep.
- User administration, PAT management, feature flags, project deletion and board deletion are not exposed over MCP.

## 10. Attachment upload

Spec [§4.8](../product/01-refined-spec.md#48-attachment-i-07), D-63. The same flow serves the Attach button, drag and drop on the attachments section, and paste or drop into a markdown editor (which then inserts `![name](/api/v1/attachments/{id})`).

```mermaid
sequenceDiagram
    participant B as Browser
    participant A as API (UploadAttachment)
    participant DB as PostgreSQL
    B->>A: POST /tickets/WEB-42/attachments (multipart "file")
    A->>A: Write access to the ticket's project (404 unreadable, 403 viewer, 409 archived)
    A->>A: Size 1 B..10 MiB, allow-listed type, bytes match the type
    A->>DB: BEGIN; SELECT ticket FOR UPDATE; count attachments
    alt 50 already
        A-->>B: 409 attachment.limitReached
    else
        A->>DB: INSERT attachment + attachment_content, bump ticket UpdatedAt, activity attachment.added
        A-->>B: 201 attachment (url /api/v1/attachments/{id})
    end
```

- Delete: the uploader (with write access) or a project Owner. It removes the metadata and the content and records `attachment.removed`.
- Read: anyone who can read the ticket. Attachments of deleted tickets answer 404 like the ticket.
