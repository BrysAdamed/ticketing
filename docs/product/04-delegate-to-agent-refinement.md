# Delegate to agent: refined spec, triage, open questions, ticket breakdown

Product refinement of the owner's "Implement / Delegate to agent" idea. A tech researcher covers protocol registration, the helper-app technology, how Claude Code is started and the security mechanics in parallel; a prompt designer drafts the default prompts. This document fixes the product behaviour both of them plug into. Where it names a mechanism (token length, polling interval), the researcher may replace it as long as the product rule still holds.

Owner's idea (verbatim):

> add a button on the ticket page at the top that says something like 'Implement' or 'Delegate to agent'. It would then open the link with some custom protocol that would open up some simple app on our computer. That app would then trigger the headless claude session. Each project should be able to define a different prompt for each of the ticket types. … The small app, when installed on a computer, would register a protocol and when opened from the ticketing system would have to check if it knows where the code was cloned. If it does not know it asks user to point at a folder. If it does know - it opens the claude code there with the prompt it received.

Proposed numbering. The Docs refinement (03) already claims spec §12, ideas I-82..I-105 and questions Q-06..Q-10, and TKT-5/TKT-7 used D-93 and D-94. So this feature takes spec **§13 "Agent delegation"**, ideas **I-106 onwards**, questions **Q-11 onwards**, and records its decisions (AD-1..AD-n below) as the next free `D-xx` numbers at merge time. Ticket label `agent`.

---

## 1. Refined spec

### 1.1 The flow in one picture

```
Ticket page                 Ticketing API                  Helper app (user's PC)             Claude Code
-----------                 -------------                  ----------------------             -----------
[Delegate to agent] --POST /tickets/K/agent-launches-->  (cookie + anti-forgery)
                    <-- { launchId, launchUrl } -------  AgentLaunch Pending, prompt rendered
open ticketing-agent://launch?v=1&i=<origin>&t=<token> --------->  origin in allowlist?
                                                                   POST /agent-launches/redeem (PAT)
                            AgentLaunch Redeemed  <---------------  
                            ---- prompt, ticket, repo, options --->  find or ask for the clone folder,
poll GET /agent-launches/{id}                                       check git remote = repositoryUrl,
  "Confirm in the helper"                                           show confirmation dialog
                                                                   [Launch]
                            POST /agent-launches/{id}/start  <----  
                            activity, assign, InProgress            start Claude Code in the folder --> works the ticket
  "Delegated" toast                                                                                   over MCP as the user
```

The URL carries only the instance origin and a random single-use token. A web page that fires the protocol on its own gets nothing: it cannot mint a token for the victim (minting needs the victim's cookie and anti-forgery token), and a token minted in the attacker's account fails to redeem with the victim's PAT.

### 1.2 Scope and non-goals for v1

In v1:
- Prompt templates per ticket type: built-in defaults, an Admin-edited instance default, an optional per-project override, full version history.
- An Admin-edited **guardrails** block appended to every prompt, which projects cannot remove.
- Project settings `repositoryUrl`, `defaultBranch`, an opt-in switch and two "on launch" side effects.
- A **Delegate to agent** button and **Copy prompt** on the ticket page and peek.
- Short-lived launch tokens, an `AgentLaunch` record, history entry "delegated to agent".
- A Windows helper app: instance and token setup, protocol handler, clone-folder mapping, confirmation, launching Claude Code interactive or headless.
- MCP `get_agent_prompt`.
- Everything behind the feature flag `agent.delegate`.

Not in v1 (section 2): reporting run status back (`AgentRun`), bulk or epic delegation, queueing, cloud execution, transcripts, cost, other agents, per-user prompt overrides, editing templates over MCP or REST with a PAT.

### 1.3 Domain model

New enums:

| Enum | Values | Notes |
| --- | --- | --- |
| `AgentPromptScope` | `Instance`, `Project` | |
| `AgentPromptMode` | `Inherit`, `Custom`, `Off` | Project rows only. Instance rows are always `Custom`. |
| `AgentKind` | `ClaudeCode` | One value in v1, so other agents (I-106) are additive. |
| `AgentExecutionMode` | `Interactive`, `Headless` | Interactive opens a visible terminal session; Headless runs `claude -p` with its output written to a log the helper can open. |
| `AgentPermissionMode` | `Default`, `AcceptEdits`, `Plan` | Claude Code permission modes. `bypassPermissions` is deliberately absent (AD-7). |
| `AgentLaunchStatus` | `Pending`, `Redeemed`, `Started`, `Cancelled` | Expired is derived from `ExpiresAt`. |

`ActivityEntityType` gains `AgentPrompt`.

**Project** (additive migration)

| Field | Type | Constraints |
| --- | --- | --- |
| RepositoryUrl | text(500)? | `https://host/path`, `ssh://[user@]host[:port]/path` or `git@host:path`, optional `.git`. Stored as typed; compared normalized (lower-case host, no scheme or user, no `.git`, no trailing `/`), so the https and ssh forms of one repository match. Error `project.repositoryUrl.invalid`. |
| DefaultBranch | text(100) | Default `main`. Git ref name rules. |
| AgentDelegationEnabled | bool | Default false. Turning it on requires `RepositoryUrl` (`agent.project.repositoryRequired`). |
| AgentAssignOnStart | bool | Default true. On start, assign the ticket to the delegating user **if it is unassigned**. |
| AgentStartProgressOnStart | bool | Default true. On start, move the ticket from `ToDo` to `InProgress`. Other statuses are left alone. |

**AgentPromptTemplate** (one row per slot)

| Field | Type | Constraints |
| --- | --- | --- |
| Id | uuid | |
| Scope | AgentPromptScope | |
| ProjectId | uuid? | Set if and only if Scope = `Project`. |
| TicketType | TicketType? | Null means the guardrails block, allowed only at `Instance` scope. |
| Mode | AgentPromptMode | |
| Body | text(20000)? | Required for `Custom`, null otherwise. Syntax in 1.4. |
| LaunchOptions | jsonb | `{ agent, executionMode, permissionMode, model? }`. Null for guardrails and for `Inherit`/`Off` project rows. `model` is text(50)?, an alias or model id passed through; empty means the user's Claude Code default. |
| CurrentVersion | int | ≥ 1 |
| BasedOnDefaultVersion | int? | Project `Custom` rows: the instance default version the override was created or last compared against. Drives the "default changed since" banner. |
| UpdatedAt, UpdatedById | timestamptz, uuid? | UpdatedById null for system (built-in) versions. |
| RowVersion | | |

Unique (Scope, ProjectId, TicketType) with nulls not distinct. Six instance rows always exist (five types plus guardrails); startup creates missing ones from the built-ins. Project rows exist only once an Owner changes a type away from `Inherit`.

**AgentPromptTemplateVersion** (immutable, never deleted)

| Field | Type | Constraints |
| --- | --- | --- |
| TemplateId, Number | uuid, int | Unique together, 1..n. |
| Mode, Body, LaunchOptions | | Snapshot. |
| BuiltInVersion | text(20)? | Set when the version came from the shipped defaults, for example `2026.11.1`. |
| ChangeNote | text(200)? | |
| AuthorId | uuid? | Null for system versions. |
| CreatedAt | timestamptz | |
| RestoredFrom | int? | Set by "Restore version n". |

**Built-in defaults** ship as embedded resources with a `BuiltInVersion`. They include the two fixed `{{run.mode}}` sentences (1.4), which are not editable in v1. On startup, if an instance row's versions were all written by the system and the shipped `BuiltInVersion` is newer, the system adds a new version with the new text. If an Admin has edited it, nothing changes automatically; the Admin page shows "A newer built-in default is available · Compare · Adopt".

**AgentLaunch**

| Field | Type | Constraints |
| --- | --- | --- |
| Id | uuid | |
| TicketId, ProjectId, UserId | uuid | The delegating user. |
| TokenHash | text(64) | SHA-256 hex of the token. Unique. The token itself is never stored or logged. |
| Status | AgentLaunchStatus | |
| TemplateId, TemplateVersion | uuid, int | The type template actually used (project override or instance default). |
| GuardrailsVersion | int | |
| RenderedPrompt | text(32000) | Rendered at mint time, returned unchanged on redeem. |
| ExecutionMode, PermissionMode, Model | | From the template at mint; replaced by what the user chose in the helper on start. |
| HelperVersion | text(50)? | Reported on redeem. |
| CreatedAt, ExpiresAt | timestamptz | ExpiresAt = CreatedAt + 120 s. |
| RedeemedAt, StartedAt, CancelledAt | timestamptz? | |

Retention: rows that never started are deleted 7 days after creation by the existing retention job. Started rows are kept; they are the record of what ran, which a later `AgentRun` (I-116) extends.

**Configuration**: new environment variable `TICKETING_PUBLIC_URL` (for example `http://localhost:8090`). The API builds `{{instance.url}}`, `{{ticket.url}}` and the launch URL's origin from it, never from request headers. While it is unset, delegation stays off for everyone and the Admin page says why (`agent.instance.notConfigured`).

### 1.4 Template language

Plain text with placeholders. Markdown inside is fine and is shown as written.

- `{{name}}`, spaces inside the braces allowed. Replaced verbatim; a null value renders as empty.
- `{{#if name}}…{{/if}}` keeps its content when the value is non-empty. No `else` and no nesting in v1 (`agent.template.nestedIf`).
- `\{{` renders a literal `{{`.
- Unknown placeholder (`agent.template.unknownPlaceholder`), an unclosed or stray block (`agent.template.unbalancedIf`), an empty body or a body over 20 000 characters fail validation on save. Each error carries line and column, so the editor can underline it.
- The rendered prompt (type template + blank line + guardrails) may not exceed 32 000 characters (`agent.prompt.tooLong`). With titles capped at 255 this only fails on pathological templates.
- One renderer, on the server. The editor's preview calls it, so there is no TypeScript twin.

| Placeholder | Value |
| --- | --- |
| `ticket.key`, `ticket.title`, `ticket.type`, `ticket.status`, `ticket.priority`, `ticket.severity` | Enum values as in spec §3 (`UserStory`, `InProgress`). |
| `ticket.url` | Absolute: `{TICKETING_PUBLIC_URL}/p/{PK}/t/{KEY}`. |
| `ticket.slug` | Kebab-case title, ASCII, at most 40 characters, for branch names: `fix-login-redirect`. |
| `ticket.parentKey`, `ticket.parentTitle` | Empty when there is no parent. |
| `ticket.labels` | Comma-separated, sorted. |
| `ticket.version` | |
| `project.key`, `project.name`, `project.repositoryUrl`, `project.defaultBranch` | |
| `instance.url` | `TICKETING_PUBLIC_URL`. |
| `user.email`, `user.name` | The delegating user. |
| `launch.id` | The AgentLaunch id. Empty in Copy prompt and in previews. |
| `template.id` | `<TicketType> v<n> / <D\|C>`, for example `Bug v3 / C` (D = instance default, C = project custom). Lets the closing comment say which prompt ran. |
| `run.mode` | Reserved, filled last. The server renders everything else and leaves this marker; on start the helper replaces it with one of two fixed sentences that come from the server in the redeem response (`runModeText.Interactive`, `runModeText.Headless`), picked by the mode the user confirmed. The helper chooses, it never writes text. Copy prompt and previews use the Interactive sentence. |

There is deliberately **no** `ticket.description` or comments placeholder (AD-4). The prompt tells the agent to read the ticket with `get_ticket`; the confirmation dialog then shows only text written by Owners and Admins, and descriptions stay out of the instruction channel.

### 1.5 Resolving the prompt for a ticket

1. Flag `agent.delegate` off for the user, or `TICKETING_PUBLIC_URL` unset: `agent.disabled` (REST 404).
2. Project not readable: 404 as everywhere. Archived project or deleted ticket: `agent.unavailable`.
3. `AgentDelegationEnabled = false`: `agent.project.disabled`.
4. The project row for the ticket's type: `Off` gives `agent.type.off`; `Custom` uses its body and options; `Inherit` or no row uses the instance default.
5. Render the type template, then append the guardrails block if it is non-empty.

### 1.6 Permissions (mapped to §5)

| Action | Owner/Admin | Member (public project: every signed-in user) | Viewer | No access |
| --- | --- | --- | --- | --- |
| See the Agent settings tab, templates, versions, diff (read-only for non-Owners) | Yes | Yes | Yes | 404 |
| Edit project agent settings and templates; restore a version; reset to default | Yes | No | No | 404 |
| Copy prompt, `get_agent_prompt` | Yes | Yes | Yes | 404 |
| Delegate to agent (mint a launch) | Yes | Yes | No | 404 |
| Edit instance defaults and guardrails | Admin only | No | No | No |

All of it also requires the flag to be on for the user. Additional rules:
- Template and agent-setting writes, and minting a launch, accept the **cookie session only** (`auth.cookieSessionRequired` for a PAT), like PAT and flag management. Rationale in AD-6.
- Redeem, start and cancel accept a **ReadWrite PAT only**. A cookie gets `auth.unauthenticated`, a ReadOnly PAT `pat.readOnlyScope`.
- A user can see and act only on their own launches. Anyone else's launch id is a 404.
- On an archived project everything is read-only and the button is hidden.

### 1.7 Launch lifecycle

**Mint** `POST /api/v1/tickets/{key}/agent-launches` (cookie, anti-forgery).
- Checks 1.5 and write access, renders and stores the prompt, returns `{ launchId, launchUrl, expiresAt }`.
- `launchUrl` is `ticketing-agent://launch?v=1&i={base64url(origin)}&t={token}`, the token 32 random bytes in base64url. Nothing else goes in the URL: no prompt, no key, no title, no user.
- Limits: 20 mints per minute per user (429), at most 10 unexpired `Pending` launches per user (the oldest is cancelled).
- No activity entry. Clicking without a helper leaves no trace in history.

**Redeem** `POST /api/v1/agent-launches/redeem` `{ token, helperVersion }` (ReadWrite PAT).
- Atomic `Pending → Redeemed`. It fails with one indistinguishable `404 agent.launch.notFound` if the token is unknown, expired, already used, or belongs to another user. A wrong-user attempt does not consume the token and is logged at warning level without the token.
- It re-checks 1.5 and write access at redeem time. A user who lost access between mint and redeem also gets `agent.launch.notFound`.
- Response: `{ launchId, instanceUrl, ticket: { key, title, type, status, assignee, url }, project: { key, name, repositoryUrl, defaultBranch }, template: { source: Custom|Default, version, updatedAt, updatedBy }, guardrailsVersion, prompt, runModeText: { Interactive, Headless }, launchOptions, assignOnStart, startProgressOnStart }`. `prompt` still contains the `{{run.mode}}` marker (1.4).

**Start** `POST /api/v1/agent-launches/{id}/start` `{ executionMode, permissionMode, model }` (same user's ReadWrite PAT), within 10 minutes of redeem.
- The helper may only keep or narrow the options: Headless may become Interactive, and AcceptEdits may become Default or Plan, never the reverse (`agent.launch.optionsWidened`).
- In one transaction: status `Started`, history entry `ticket.agent.delegated`, then the project's side effects (assign if unassigned, `ToDo → InProgress`) as ordinary field changes with the same `OccurredAt` and channel `Api`. Watchers get the usual StatusChanged notification; self-assignment notifies nobody (6.16).
- Errors: `agent.launch.notRedeemed`, `agent.launch.alreadyStarted`, `agent.launch.redeemExpired`.

**Cancel** `POST /api/v1/agent-launches/{id}/cancel` from the helper's Cancel button. No history entry.

**Status** `GET /api/v1/agent-launches/{id}` (cookie, own launches) returns `{ status, expiresAt, redeemedAt, startedAt }` for the web page's progress display.

History renders the entry as "**Anna** delegated to agent · Bug prompt v3 (custom) · interactive". `NewValue` holds `{ launchId, templateSource, templateVersion, guardrailsVersion, executionMode, permissionMode, model, helperVersion }`. It never holds the prompt or the local folder.

### 1.8 The ticket page

**Placement.** The ticket header bar, right side, before `…`:
- Full page: a labelled split button **Delegate to agent** with a chevron menu: Copy prompt, Preview prompt, Set up the helper…
- Peek (640 px): an icon button (agent icon, tooltip "Delegate to agent ⇧D") with the same menu on its chevron.
- The `…` menu also lists "Delegate to agent" and "Copy agent prompt", for discoverability.

The ticket view only takes extensions through `provideTicketDetailSection` today. This needs a second extension point, `provideTicketHeaderAction` in `core/tickets`, so the agent feature does not edit the ticket view (CLAUDE.md rule).

**Visibility.**

| Condition | Result |
| --- | --- |
| Flag off, Viewer, archived project, `TICKETING_PUBLIC_URL` unset | Hidden, menu items too. |
| Project delegation off | Members: hidden. Owners: shown disabled, tooltip "Agent delegation is off for this project · Set up", linking to the Agent tab. |
| Ticket type set to `Off` in the project | Hidden, menu items too. |
| Status `Done` | Disabled, tooltip "Reopen the ticket to delegate it". Copy prompt still works. |
| A launch from this page is in progress | Disabled with a spinner until it ends or the fallback shows. |

**Click** (or `Shift+D`, Ticket scope, listed in `?`):
1. Mint, then open `launchUrl` through a hidden iframe so the page does not navigate.
2. A popover under the button shows progress, polling the status endpoint every second:
   - `Pending`: "Opening the agent helper…"
   - `Redeemed`: "Confirm the launch in the helper window"
   - `Started`: popover closes, toast "Delegated TKT-42 to agent · View history", and the ticket refreshes (assignee and status may have changed).
   - `Cancelled`: "Launch cancelled in the helper" for 3 seconds.
3. Still `Pending` after 6 seconds: the popover becomes the fallback: "The agent helper didn't respond." with **Install the helper** (setup dialog), **Copy prompt** and **Try again**. The first time in a browser (nothing in local storage says the helper ever answered) the setup hint shows immediately next to the progress line.
4. Polling stops at token expiry (120 s) or when the popover closes.

Browsers cannot reliably detect a protocol handler. The server-side status is the detection.

**Copy prompt.** `GET /api/v1/tickets/{key}/agent-prompt` returns `{ prompt, template, guardrailsVersion, launchOptions }` with an empty `launch.id`. The prompt goes to the clipboard; toast "Prompt copied. Paste it into Claude Code in your clone of {repositoryUrl}". No history entry and no side effects. It works without the helper, for anyone who prefers pasting.

**Preview prompt.** A read-only dialog with the rendered prompt, its template source and version, and a Copy button.

**Set up the helper.** A dialog: what the helper is, the download link (`TICKETING_AGENT_HELPER_URL`, otherwise a link to `docs/agent-helper.md`), this instance's URL with a copy button, and **Create helper token**, which opens the existing token dialog pre-filled with name "Agent helper", ReadWrite, 90 days. The same content lives under Profile → Agent helper.

### 1.9 The helper app (product behaviour)

The researcher owns how it is built. The behaviour the product relies on:

1. **Setup.** The user adds an instance by typing or pasting its URL and pasting a PAT. The helper calls `whoami`, shows "Signed in as anna@… on http://localhost:8090", and stores the PAT in the OS credential store. Several instances are allowed. The allowlist is changed only in the helper's own window, never by a URL.
2. **Protocol URL.** Unknown `v`, an origin not in the allowlist, or a malformed token: the helper shows "This link came from an instance you haven't added" with the origin, and does nothing else. No network call.
3. **Redeem** with that instance's PAT. Errors show as one line: "This launch link has expired or was already used. Click Delegate again."
4. **Folder.** The map key is instance + project key, and the map lives only on the user's machine. The server never learns paths.
   - Known folder: check that it exists, is a git working tree, and that one of its remotes matches `repositoryUrl` (normalized as in 1.3).
   - Unknown or failed check: a folder picker with the reason ("No clone of gitlab.example.com/team/ticketing is known yet" or "D:\src\ticketing has no remote matching …"). The helper remembers the folder once the check passes. A mismatched folder cannot be launched in.
   - Settings list mappings with Change and Forget.
5. **Confirmation**, always, in v1. It shows: instance, ticket key and title, delegating user, project, folder with its current branch, a warning line if the working tree has uncommitted changes, template source and version with "changed by Anna 2 days ago", a highlighted "Prompt changed since your last launch in this project" when the template or guardrails version differs from the last one this helper started for the project, the execution and permission mode (each may only be narrowed), the model, and the full prompt (6 lines, expandable). Buttons: **Launch** (default) and **Cancel**. A launch reaches `/start` only after the click.
6. **Launch.** Start Claude Code in the folder with the prompt. Interactive opens a terminal window the user can watch and type into. Headless runs without a window, writes output to a per-launch log, and shows an OS notification when the process exits, with "Open log". The prompt and the PAT never appear on a command line visible in the process list.
7. **MCP access.** The session must reach Ticketing over MCP as the delegating user, or the prompt cannot work. Whether the helper injects an MCP config for the instance or relies on the repo's `.mcp.json` with `TICKETING_TOKEN` is the researcher's call. Either way the PAT does not enter the prompt.
8. Windows 11 only in v1 (AD-10).

### 1.10 Settings UI

**Project settings → Agent** (a new tab or sub-page next to the existing General/Members/Danger zone content; shown only when the flag is on; read-only for non-Owners):

- **Setup card.** Enable delegation toggle, Repository URL (validated as you type, with the normalized form shown underneath: "Matches clones of gitlab.example.com/team/ticketing"), Default branch, and the two on-start toggles "Assign to the delegating user if unassigned" and "Move To Do tickets to In Progress".
- **Prompt per type.** Five rows (Epic, User story, Technical, Spike, Bug) with a state chip: `Default v4`, `Custom v2`, `Off`, and who changed it when.
- **Editor** (opens on a row; full-width page, URL `/p/{PK}/settings/agent/{type}`):
  - Mode segmented control: Use default · Custom · Off.
  - Monospace editor for Custom. Typing `{{` opens a placeholder completion list from 1.4. Validation errors are underlined with their message.
  - Live preview on the right, rendered by the server 400 ms after the last change for a sample ticket. The picker defaults to the most recently updated ticket of that type in the project, or a synthetic sample when there is none. Guardrails show below a divider, greyed, labelled "Added to every prompt by your Admin".
  - Launch options: execution mode, permission mode, model (free text with hints `opus`, `sonnet`, empty = "user's default").
  - Change note, **Save** (`⌘S`), sending `baseVersion` (stale: `agent.prompt.versionConflict`, reload with a warning, as in the test case editor).
  - **Compare with default**: side-by-side line diff against the current instance default. **Reset to default** sets the mode to Use default as a new version; the custom text stays recoverable in history.
  - Banner on a Custom row whose `BasedOnDefaultVersion` is older than the current default: "The default prompt changed after this was customised · Compare · Mark as reviewed".
  - **History**: versions with author, time, note; view any version, diff it against the current one, restore it as a new version.
- Unsaved changes ask before leaving the page.

**Admin → Agent prompts** (next to Feature flags; Admins with the flag on): the same editor for the five instance defaults and the guardrails block, without the Use default/Off modes. It adds "Reset to built-in", the "newer built-in available" banner, and per type the number of projects overriding it (links to a list of those projects). A status line shows whether `TICKETING_PUBLIC_URL` is set.

Both screens: skeletons while loading, light and dark themes, keyboard reachable, empty and error states per the design system.

### 1.11 REST and MCP

| Method and path | Purpose | Auth |
| --- | --- | --- |
| `GET /projects/{pk}/agent` | Setup fields plus the five types: mode, effective source and version, updatedBy/At, launch options, default version, `defaultChanged` | cookie or PAT, read |
| `PATCH /projects/{pk}/agent` | Setup fields, `If-Match` | cookie, Owner |
| `GET /projects/{pk}/agent/prompts/{type}` | Row plus effective body | cookie or PAT, read |
| `PUT /projects/{pk}/agent/prompts/{type}` | `{ mode, body?, launchOptions?, changeNote?, baseVersion }` | cookie, Owner |
| `GET /projects/{pk}/agent/prompts/{type}/versions[/{n}]` | History | cookie or PAT, read |
| `POST /projects/{pk}/agent/prompts/{type}/versions/{n}/restore` | Restore as a new version | cookie, Owner |
| `POST /projects/{pk}/agent/prompts/{type}/preview` | `{ body, ticketKey? }` returns `{ prompt }` or validation errors; nothing stored | cookie, read |
| `GET\|PUT /admin/agent/prompts/{type\|guardrails}`, `.../versions`, `.../restore`, `.../reset-built-in`, `.../preview` | Instance defaults | cookie, Admin |
| `GET /tickets/{key}/agent-prompt` | Resolved prompt (Copy prompt) | cookie or PAT, read |
| `POST /tickets/{key}/agent-launches` | Mint | cookie, write |
| `POST /agent-launches/redeem`, `POST /agent-launches/{id}/start`, `POST /agent-launches/{id}/cancel` | Helper | ReadWrite PAT, own |
| `GET /agent-launches/{id}` | Status for the web page | cookie, own |

Every endpoint returns 404 `agent.disabled` while the flag is off for the caller.

MCP:

| Tool | Inputs | Output | Hints |
| --- | --- | --- | --- |
| `get_agent_prompt` | `key` | `{ prompt, ticketKey, template: { source, version }, guardrailsVersion, launchOptions }` | read |

- An agent session started by hand ("work on TKT-42") can fetch the same instructions the button would have given it. `docs/mcp.md` gets a two-line recipe for a Claude Code slash command that does this.
- Listed only when the flag is on for the token's user. Calling it with the flag off returns `agent.disabled`.
- `get_project` returns `repositoryUrl`, `defaultBranch` and `agentDelegationEnabled`. `update_project` does **not** accept them (cookie only, AD-6).
- No MCP tools for launches or template edits in v1.

### 1.12 Feature flag

`agent.delegate`, a string-variant flag (`on`/`off` in v1, spec §6.13). Admins target themselves first, then the TKT team by user ids, then roll out by percentage. Off means: no button or menu items, no Agent settings tab, no Admin page, no Profile → Agent helper section, all endpoints 404 `agent.disabled`, and `get_agent_prompt` missing from `tools/list`. Stored templates and launches stay untouched while it is off. The SPA picks up a change on its next flag refresh (focus after 5 minutes) or a reload; the server checks on every request, so a helper redeem after the flag is turned off fails.

### 1.13 Activity and audit

- `ticket.agent.delegated` (EntityType `Ticket`), written on start (1.7).
- `agent.prompt.updated` (EntityType `AgentPrompt`, `ProjectId` set for project rows, null for instance rows, which therefore appear in the Admin audit trail). `Field` is the type name or `Guardrails`. `OldValue`/`NewValue` hold `{ version, mode }`, never the body; bodies live in versions.
- Project setup changes use the existing `project.field.changed` entries.
- Mints, redeems and cancels write no activity. They live in `AgentLaunch` and in logs (without tokens).

---

## 2. Improvements triage

| ID | Improvement | Value | Size | Verdict |
| --- | --- | --- | --- | --- |
| – | Copy prompt / Preview prompt | Works with no install; also the fallback | S | **IN** |
| – | Guardrails block (Admin, appended to every prompt) | One place for "never push to main, never print secrets"; projects can't drop it | S | **IN** |
| – | Template versions, diff vs default, "default changed since" banner | Prompts change behaviour on people's machines; they need history and review | S | **IN** |
| – | `get_agent_prompt` over MCP | Same instructions for hand-started sessions | S | **IN** |
| – | "Prompt changed since your last launch" in the helper | Cheap defence against a quietly edited template | S | **IN** |
| I-106 | Other agents (Codex CLI, Gemini CLI, Copilot CLI) | Team choice per project or user | M | LATER. `AgentKind` makes it additive: an enum value, a helper adapter, a launch option. |
| I-107 | Per-user prompt additions | Personal habits | S | LATER. The user's own `~/.claude/CLAUDE.md` already covers most of it. |
| I-108 | Delegate many tickets: a selection, or an epic's children in `Blocks` order | Hands-off batches | L | LATER. Needs I-109, I-116 and I-117 first; parallel runs in one clone collide. |
| I-109 | Queue of launches per user/machine | Run one after another | M | LATER, with I-108. |
| I-110 | Cloud or remote execution (Claude Code on the web / cloud sessions, or a CI runner) | No helper install, works from any device, runs in parallel | L | LATER, spike after v1 adoption (Q-13). The server side is target-agnostic: a cloud runner could redeem a launch exactly like the helper. |
| I-111 | Run transcript or log attached to the ticket | Review what the agent did | M | LATER. Needs MCP upload (I-66) and secret scrubbing; transcripts routinely contain env values. |
| I-112 | Cost and token tracking per run | Budget visibility | S | LATER, after I-116 (headless JSON output carries the numbers). |
| I-113 | Auto-PR/MR creation | Review starts by itself | S | **IN as prompt content only**: the default prompts push a branch and open an MR when `glab`/`gh` is available. A product-level "MR link on the ticket" is LATER. |
| I-114 | Org-wide prompt library ("copy from project X", shared snippets) | Reuse across projects | S | LATER. Instance defaults cover the common case. |
| I-115 | Template conditionals with `else`, nesting, loops | Richer templates | S | LATER. Per-type templates already remove most branching. |
| I-116 | `AgentRun` tracking: helper reports exit, agent reports `finished`/`failed` + summary (`report_agent_run`), run list on the ticket, "agent working" badge on cards | Visibility of what is running | M | LATER. v1 records the launch; the agent's own status changes and closing comment (which the default prompts require) cover progress. A crashed headless run reports nothing, so reliable tracking needs the helper to watch the process, which is the bigger half of the work. |
| I-117 | A git worktree per launch | Several delegations in one clone at once | M | LATER. v1 warns about uncommitted changes. |
| I-118 | Several repositories per project (by label or component) | Monorepo vs split repos | M | LATER. v1: one repository per project. |
| I-119 | Delegate from backlog rows, board cards and the command palette | Fewer clicks | S | LATER (after the header action proves out). |
| I-120 | Notify watchers on "delegated to agent" | Team awareness | S | LATER. The InProgress change already notifies them. |
| I-121 | Trust a project in the helper to skip the confirmation | One click less | S | LATER, and only for Interactive mode. |
| I-122 | macOS and Linux helper | Non-Windows developers | M | LATER (AD-10). |
| I-123 | `bypassPermissions` as a helper-local opt-in | Fully unattended runs | S | LATER, local only. The server never sets it. |
| – | Editing templates over MCP or with a PAT | Agents tuning prompts | S | **Not planned** (AD-6). |
| – | Agent-initiated delegation (an MCP tool that launches more sessions) | Agents fanning out work | M | **Not planned** in this design: a prompt injection could spawn sessions on the user's machine. Revisit with I-110 in a sandbox. |

---

## 3. Open questions

### Decided by me (record as the next free D-xx)

1. **AD-1 Three layers.** Built-in (shipped) → instance default (Admin) → project override (Owner), with per-type `Inherit`/`Custom`/`Off`. Built-ins exist so a new instance works on day one; the Admin layer exists because our repos share conventions; `Off` exists because some teams will not want agents near epics or spikes.
2. **AD-2 Projects opt in, and need a repository URL.** Instance defaults mean every type "has a template", so "has a template" cannot gate the button. An explicit switch plus `repositoryUrl` does, and gives the helper something to verify the clone against.
3. **AD-3 Minimal template language, server-rendered.** Placeholders and a flat `if`. Precise errors, one renderer for preview and launch, nothing to keep in sync in TypeScript. Liquid or Handlebars would bring loops and filters nobody asked for, and a bigger attack area in text that runs on developer machines.
4. **AD-4 No description or comment placeholders.** Ticket text is writable by any signed-in user on public projects (D-02). Inlining it makes it look like part of the instructions and makes the confirmation dialog unreadable. The agent reads the ticket through MCP like any other data.
5. **AD-5 Launch = mint (cookie) + redeem (PAT) + start, the URL carries only origin and token.** Each half needs a different credential, the token lives 120 s, is single-use and bound to the user, and wrong-user, expired and used tokens look identical. History records only launches the user confirmed in the helper.
6. **AD-6 Template and agent-setting writes are cookie-only.** A PAT sits inside agent sessions. If a PAT could edit templates, one prompt injection (a malicious ticket read by an Owner's agent) could rewrite the instructions every later launch runs on teammates' machines. This matches how PATs, users and flags are already kept out of reach (D-37).
7. **AD-7 Server-provided options can only narrow.** The helper may keep or narrow mode and permissions, never widen them; `bypassPermissions` cannot come from the server at all. The person whose machine runs the agent has the last word.
8. **AD-8 Side effects on start, on by default, per project.** On confirmed start: assign to the delegating user if unassigned, `ToDo → InProgress`. Never reassign someone else's ticket. Doing it on the server at start time makes the board correct immediately, even if the agent forgets or fails before its first MCP call; doing it at mint time would mark tickets as started when the helper isn't installed. Owners who dislike it switch it off.
9. **AD-9 No `AgentRun` status reporting in v1.** The launch record plus the agent's own status changes and closing comment cover v1. Reliable run tracking is I-116.
10. **AD-10 Windows 11 first.** Everyone on the team is on Windows 11. The helper and protocol registration are per-OS work; macOS/Linux is I-122. The researcher can overturn this if the chosen stack makes the other platforms free.
11. **AD-11 `TICKETING_PUBLIC_URL`.** Absolute URLs in prompts and the launch origin come from configuration, not from `Host` headers, so a spoofed header cannot point a helper elsewhere. Delegation stays off until it is set.
12. **AD-12 Folder mappings stay on the user's machine.** The server has no need for local paths, and they reveal user names and disk layout.
13. **AD-13 The button lives in the header bar** of both the full page and the peek, and needs a new `provideTicketHeaderAction` extension point rather than an edit of the ticket view. Shortcut `Shift+D` (free in Ticket scope; Docs uses it only in its own scope).

### Needs the owner

**Q-11: Interactive or headless by default?**
- A: Interactive. A visible terminal with Claude Code running the prompt; the user can watch, answer permission prompts and steer.
- B: Headless (`claude -p`), as in the original idea. No window, a notification at the end. Without a permission bypass it stops at the first action needing approval, so it needs `AcceptEdits` plus an allow-list of tools.
- C: Per type. Interactive for UserStory/Technical/Bug, Headless in `Plan` mode for Epic and Spike (research and breakdown, no edits).

*Recommendation: A for v1 defaults, with Headless available per type (the schema supports C either way).* Agents still need course corrections often enough that a hidden run wastes more time than it saves, and Interactive is the only mode where Claude Code's own permission prompts protect the machine.

**Q-12: Where does the default prompt stop?**
- A: Push a branch, open an MR, set the ticket to `Review`, comment with the MR link. A human merges.
- B: Merge to `main` itself and set `Done`, as CLAUDE.md currently tells agents in this repo.
- C: Stop at a local branch with commits, no push.

*Recommendation: A.* B is how we work in TKT today with a human watching every session; a one-click launch invites less attention, and nobody reviews it before `main`. Projects that want B can say so in their own template.

**Q-13: Local helper first, or cloud execution first?**
- A: Local helper (this spec). Works with our GitLab repos, local Docker, dev databases and Windows tooling; needs an install on each PC.
- B: Cloud first (I-110). No install, runs from any device and in parallel; depends on what Claude Code's cloud offering supports for GitLab-hosted repos and internal hosts like `localhost:8090`, which the researcher should confirm.
- C: Both in this epic.

*Recommendation: A now, spike B after v1.* Our instance and repos are internal, so a cloud agent could reach neither without network work we haven't scoped. Nothing on the server side needs to change for B later.

**Q-14: Who may delegate?**
- A: Anyone with write access to the project and the flag on (this spec). On public projects that is every signed-in user, but the flag limits it during rollout.
- B: Project members only (explicit membership), even on public projects.

*Recommendation: A.* It follows D-02, and the agent runs on the delegating user's own machine with their own permissions, so delegating grants nothing they couldn't do by hand.

---

## 4. Breakdown (delivery order)

### EPIC: Delegate to agent: launch Claude Code on a ticket from the ticket page (label `agent`, version 2.x)

**Goal:** a developer clicks Delegate to agent on a ticket and, after one confirmation, Claude Code starts in their local clone with the project's prompt for that ticket type. Owners and Admins manage versioned prompts. Everything sits behind `agent.delegate`.

**Out of scope:** I-106..I-123 (run tracking, bulk, queueing, cloud, transcripts, cost, other agents, other OSes).

**First usable increment:** A2 + A3 + the Copy prompt part of A6. People can paste prompts into Claude Code before the helper exists.

**Definition of done for every child:**
- Spec §13, glossary (Agent launch, Prompt template, Guardrails, Agent helper), D-xx entries, `docs/mcp.md` and `docs/ideas.md` updated.
- Additive migrations only (ADR 0006).
- Integration tests for every use case including permission and leak paths, copying `ReadableProjectsLeakGuardTests`.
- Flag off and on both tested for every new endpoint, tool and UI entry point.
- Light and dark theme checked, with screenshots on the ticket.
- No token, PAT or prompt in logs or activity (asserted where a test can see it).

---

#### A1 · Spike: helper app packaging, protocol handler and Claude Code launch on Windows · Spike · 5 pts · deps: none
Timebox 4 days. Turns the researcher's recommendation into a proof on a managed Windows 11 PC.

AC:
- [ ] A throwaway helper registers `ticketing-agent://` per user without admin rights, and Chrome, Edge and Firefox each open it from a page (recording the browser's own "open this app?" prompt and whether "always allow" sticks per origin).
- [ ] It starts Claude Code in a chosen folder with a 20 000-character prompt, Interactive (visible terminal) and Headless (log file, exit code captured), and the prompt and the PAT do not show in the process list (`Get-CimInstance Win32_Process` command lines).
- [ ] It stores and reads a secret in Windows Credential Manager.
- [ ] Packaging and signing: an installer or MSIX that installs without SmartScreen blocking on a company PC. Document the certificate we need (internal CA vs public code signing), how Intune or our software portal could distribute it, and how updates arrive.
- [ ] It checks a folder's git remotes against a URL with the normalization rules of 1.3 (https/ssh, `.git`, case).
- [ ] Output: ADR 0013-or-next "Agent helper", stack and versions, installer size, what failed. Explicit go/no-go on Headless MCP access (how the session gets the instance's MCP config without the PAT on the command line).

#### A2 · Prompt templates: model, renderer, versions, built-in defaults, admin and project REST · Technical · 8 pts · deps: none (alongside A1)
AC:
- [ ] Additive migration: `agent_prompt_template`, `agent_prompt_template_version`, the project columns of 1.3, `ActivityEntityType.AgentPrompt`.
- [ ] Startup creates the six instance rows from embedded built-ins (placeholder text until A9) and upgrades rows never edited by an Admin when `BuiltInVersion` is newer; an edited row is left alone and reports `newerBuiltInAvailable`. Unit tested with two built-in versions.
- [ ] Renderer per 1.4, unit-tested: every placeholder, null values, `if` true/false, `\{{`, nested `if` and unbalanced blocks rejected with line and column, unknown placeholder, length limits, `ticket.slug` for non-ASCII and long titles.
- [ ] Resolution per 1.5, each step tested: flag off, public URL unset, archived project, deleted ticket, project disabled, type `Off`, `Inherit` falls back to the instance default, guardrails appended only when non-empty.
- [ ] REST from 1.11 for project and admin templates: save with `baseVersion` (409 `agent.prompt.versionConflict` on stale), versions, restore, reset to default, reset to built-in, preview (nothing stored). `agent.prompt.updated` entries carry version and mode, never the body.
- [ ] Permissions per 1.6, row by row: Owner edits; Member and Viewer read; Admin edits any project and the instance; private-project outsider gets 404 with a body identical to a missing project, on every read path (settings, prompt, versions, preview).
- [ ] Template writes with a PAT (any scope) are refused with `auth.cookieSessionRequired`.
- [ ] `TICKETING_PUBLIC_URL` added to `.env.example` and the compose files; unset means `agent.disabled` everywhere.
- [ ] Every endpoint returns 404 `agent.disabled` with the flag off for the caller, and works when the caller is targeted.

#### A3 · Project agent setup, resolved prompt, `get_agent_prompt` · Technical · 3 pts · deps: A2
AC:
- [ ] `GET/PATCH /projects/{pk}/agent` with repository URL validation and normalization (https, ssh, scp-like forms, `.git`, case, trailing slash: table-driven tests), `DefaultBranch` ref-name rules, enabling without a URL fails with `agent.project.repositoryRequired`. Changes write `project.field.changed`. PATCH is Owner and cookie only.
- [ ] `get_project` (MCP and REST) shows the three fields; `update_project` ignores or rejects them per the existing unknown-field behaviour (documented).
- [ ] `GET /tickets/{key}/agent-prompt` and MCP `get_agent_prompt` return the same resolved prompt; Viewer can read it; outsider of a private project gets 404 / `ticket.notFound`; ReadOnly PAT works.
- [ ] `tools/list` contains `get_agent_prompt` only when the flag is on for the token's user; calling it with the flag off returns `agent.disabled`.

#### A4 · Launch tokens and the AgentLaunch record · Technical · 5 pts · deps: A3
AC:
- [ ] Additive migration: `agent_launch` (1.3). Retention job deletes never-started rows after 7 days.
- [ ] Mint, redeem, start, cancel and status per 1.7. The launch URL matches `^ticketing-agent://launch\?v=1&i=[A-Za-z0-9_-]+&t=[A-Za-z0-9_-]{43}$`, its origin decodes to `TICKETING_PUBLIC_URL`, and the URL contains neither the ticket key, title, prompt nor user email.
- [ ] Security tests:
  - token stored only as SHA-256; the plain token is absent from the database and from captured logs;
  - second redeem, redeem after 120 s (fake `TimeProvider`), unknown token and another user's token all return the same status, code and body (`404 agent.launch.notFound`); the other user's attempt does not consume the token;
  - a token minted by user B on project P cannot be redeemed with user A's PAT (the attacker-mints, victim-clicks case);
  - redeem with a cookie session fails, with a ReadOnly PAT fails with `pat.readOnlyScope`; mint with a PAT fails with `auth.cookieSessionRequired`; mint without the anti-forgery token fails;
  - redeem after the user lost write access, the ticket was deleted, the project archived or made private, or the flag turned off returns `agent.launch.notFound`;
  - concurrent redeems of one token (10 parallel): exactly one succeeds;
  - start with widened options fails with `agent.launch.optionsWidened`; start twice fails with `agent.launch.alreadyStarted`; start 10 minutes after redeem fails;
  - status and start on another user's launch id return 404;
  - mint rate limit (21st call in a minute → 429 with `Retry-After`) and the 10-pending cap.
- [ ] Start writes `ticket.agent.delegated` and, per project settings, assigns if unassigned and moves `ToDo → InProgress` in the same transaction with the same `OccurredAt`; an assigned ticket keeps its assignee; an `InProgress` or `Review` ticket keeps its status; both toggles off change nothing. Watchers get one StatusChanged notification; the actor none.
- [ ] Mint and cancel write no activity.
- [ ] Rendered prompt in the launch equals what `GET /tickets/{key}/agent-prompt` returned at mint time, except `launch.id` filled and the `{{run.mode}}` marker kept; a template edit between mint and redeem does not change the redeemed prompt.

#### A5 · Agent tab in project settings · User story · 8 pts · deps: A2, A3
*As a project Owner I want to set up delegation and tune the prompt for each ticket type so that agents follow our project's way of working.*

AC:
- [ ] Agent tab per 1.10, shown only with the flag on; read-only for Members and Viewers (no save controls, editor disabled); hidden entirely for outsiders (project 404).
- [ ] Setup card: toggle, repository URL with live validation and the normalized hint, default branch, on-start toggles. Enabling without a URL shows the server error inline.
- [ ] Type list with state chips and last change. Editor route `/p/{PK}/settings/agent/{type}` through the view registry.
- [ ] Editor: mode control, placeholder completion on `{{`, inline validation errors at the right line, server preview with sample-ticket picker and greyed guardrails, launch options, change note, `⌘S`, conflict reload with a warning, unsaved-changes guard.
- [ ] Compare with default (side-by-side line diff), Reset to default, "default changed since" banner with Mark as reviewed, history with view, diff and restore.
- [ ] Vitest: editor store (dirty tracking, conflict handling, debounce of preview). Playwright: enable delegation, customise the Bug prompt with a placeholder, see it in the preview, save, reset to default, restore v2 from history. Seed data through the API helper.
- [ ] Light and dark screenshots of list, editor and diff.

#### A6 · Delegate button, Copy prompt and launch progress on the ticket · User story · 5 pts · deps: A3 (Copy prompt), A4 (Delegate)
*As a developer I want to hand a ticket to Claude Code from the ticket page, or copy its prompt, without retyping the context.*

AC:
- [ ] New extension point `provideTicketHeaderAction` in `core/tickets`; the agent feature registers through it; the ticket view does not import the agent feature (lint rule passes).
- [ ] Button and menu per 1.8 in the full page (labelled split button) and the peek (icon button); also in `…`.
- [ ] Visibility table of 1.8 tested case by case: flag off, Viewer, archived project, project disabled (hidden for Member, disabled with the Set up link for Owner), type `Off`, status Done (disabled, Copy still works).
- [ ] Click and `Shift+D` mint and open the protocol without navigating away; the popover shows Pending → Redeemed → Started (toast, ticket refreshed with the new assignee and status) or Cancelled; fallback after 6 s with Install the helper, Copy prompt, Try again; first-run hint when this browser never saw a helper answer; polling stops at expiry or close.
- [ ] Copy prompt copies the resolved prompt and shows the toast; Preview prompt dialog; Set up the helper dialog with the token preset (name "Agent helper", ReadWrite, 90 days), also under Profile → Agent helper.
- [ ] `Shift+D` appears in the `?` sheet under Ticket and is ignored while an overlay is open (D-81 rule).
- [ ] Playwright: with a fake helper (a test that calls redeem and start with a PAT when the page mints), the ticket shows "delegated to agent" in History and is InProgress and assigned to the user; with no helper the fallback appears and Copy prompt puts the prompt on the clipboard. Flag off: no button, no menu items, `Shift+D` does nothing.
- [ ] Light and dark screenshots: button, popover states, fallback, setup dialog.

#### A7 · Admin defaults and guardrails page · User story · 3 pts · deps: A2, A5 (reuses the editor)
*As an Admin I want to maintain the default prompts and the guardrails every prompt ends with.*

AC:
- [ ] Admin → Agent prompts per 1.10, flag-gated, Admin only (a User gets the standard admin not-found).
- [ ] Editor reuse for the five defaults and guardrails; Reset to built-in; "newer built-in available" banner with Compare and Adopt; count of overriding projects linking to their list (only projects exist; Admins see all).
- [ ] Status line for `TICKETING_PUBLIC_URL`.
- [ ] Changes appear in the Admin audit trail as `agent.prompt.updated` without the body.
- [ ] Playwright: edit guardrails, see them appended in a project's preview and in Copy prompt.

#### A8 · Agent helper v1 (Windows) · User story · 13 pts · deps: A1, A4
*As a developer I want a small app that turns a Delegate click into a Claude Code session in the right clone, after I confirm.*

AC:
- [ ] Setup per 1.9.1: add instance by URL and PAT, `whoami` check, Credential Manager storage, several instances, remove instance.
- [ ] URL handling per 1.9.2: unknown `v`, origin not in the allowlist and malformed token each show the refusal and make **no** network call (verified with a network capture or a test double).
- [ ] Redeem, folder mapping and remote verification per 1.9.4: known folder used; missing folder, non-git folder and mismatched remote each lead to the picker with the reason; https vs ssh forms of the same repo match; mappings listed, changed and forgotten in settings.
- [ ] Confirmation per 1.9.5, including the dirty-tree warning, the "prompt changed since your last launch" highlight, and narrowing-only option controls. Cancel calls `/cancel`; closing the window counts as Cancel.
- [ ] Launch per 1.9.6 in Interactive and Headless; Headless shows a notification with Open log on exit; prompt and PAT absent from process command lines.
- [ ] The started session can call `whoami` over MCP as the delegating user (the A1 go/no-go mechanism).
- [ ] Error lines for expired or used links, revoked or expired PAT ("Your helper token expired · Update token"), instance unreachable.
- [ ] Signed installer from A1's pipeline; `docs/agent-helper.md` covers install, setup, troubleshooting and uninstall.
- [ ] Security tests: a page on another origin firing `ticketing-agent://launch?v=1&i=<our origin>&t=<random>` produces only the "expired or used" message; a link with `i=` of a non-allowlisted origin carrying a valid-looking token makes no request; a mapped folder whose remote was changed to another URL is refused at the next launch.

#### A9 · Default prompts per type and dogfooding in TKT · Technical · 3 pts · deps: A2 (text), A8 (dogfood)
AC:
- [ ] The prompt designer's five defaults and guardrails ship as built-ins (`BuiltInVersion` set), reflecting the owner's answers to Q-11 and Q-12. Each uses only 1.4 placeholders, tells the agent to read the ticket with `get_ticket`, follow the repository's CLAUDE.md, keep the ticket status current, and finish with a comment on the ticket (what changed, branch or MR link, anything deferred as a new ticket).
- [ ] Epic default plans and breaks down (creates children with `create_tickets`), Spike default researches and reports without merging; neither edits code by default.
- [ ] TKT on the dogfood instance has delegation enabled with `repositoryUrl` set; three real tickets (one Bug, one Technical, one Spike) are delegated end to end, and the outcome is noted on this epic.
- [ ] `docs/mcp.md` gains the `get_agent_prompt` recipe for hand-started sessions.

#### A10 · Security review of agent delegation · Technical · 3 pts · deps: A4, A6, A8
AC:
- [ ] Threat model written in `docs/architecture/` covering: a malicious website firing the protocol; an attacker-minted token; a token leaked through browser history or extensions; a malicious project Owner editing a template; prompt injection through ticket text read by the agent; a stolen helper PAT; DNS or `Host` spoofing of the instance origin. Each threat lists the control and the test that proves it.
- [ ] A reviewer outside the implementing pair runs the A4 and A8 security tests and tries at least the first four threats by hand; findings become tickets.
- [ ] Confirms no token, PAT, prompt or local path appears in nginx logs, API logs, activity, notifications or error bodies.

**Points:** A1 5 · A2 8 · A3 3 · A4 5 · A5 8 · A6 5 · A7 3 · A8 13 · A9 3 · A10 3 = **56**.

**Order and parallelism:** A1 and A2 start together. A3 follows A2, then A4. A5 and A6 (Copy prompt first) run in parallel once A3 is in. A7 after A5. A8 needs A1 and A4. A9's text can land with A2's built-ins being replaced later; its dogfooding waits for A8. A10 last.

---

## 5. What the parallel work must fit

For the tech researcher:
- The URL is fixed at `ticketing-agent://launch?v=1&i=<base64url origin>&t=<token>`; anything more in it breaks AD-5.
- The helper never widens server options (AD-7), always confirms (v1), keeps folder mappings local (AD-12) and verifies remotes with the 1.3 normalization.
- Open for the researcher: helper stack, installer and signing, how Headless gets MCP config without exposing the PAT, how Interactive opens the terminal, and whether macOS/Linux come for free (AD-10).

For the prompt designer:
- Placeholders are exactly those in 1.4. There is no description placeholder (AD-4). Your draft (`04-delegate-to-agent-prompts.md`) uses `{{run.mode}}` and `{{template.id}}`; both are now in 1.4. `{{run.mode}}` stays a launcher-filled marker, but its two sentences live on the server (instance setting, shipped with the built-ins) so the helper only picks one.
- Write five type prompts plus a guardrails block. Each type prompt must work on its own, and the guardrails are always appended after it.
- Where the prompt stops (Q-12) and the mode (Q-11) follow the owner's answers. Draft for the recommendations (MR + Review, Interactive) until then.

---

## 6. Owner answers and the revised architecture (2026-10-27) — supersedes §4 where they differ

The [technical research](../research/delegate-to-agent.md) found that Claude Code already registers its own per-user URL handler on Windows, macOS and Linux: `claude-cli://open?cwd=<absolute path>&q=<prompt>` opens a terminal in that folder with the prompt **prefilled but not sent** (≤ 5 000 characters, with Claude's own "external link" warning). Claude Desktop offers `claude://code/new?folder=&q=` (always confirms the folder).

| Question | Answer |
| --- | --- |
| Q-11 How v1 launches | **Claude's built-in deep links.** No helper app of our own in v1: nothing to build, sign or distribute. The developer sees the prompt and presses Enter, which is also the human confirmation step. Our own helper (auto-start, background runs, enforced flags, run reporting) becomes LATER (I-124). |
| Q-12 Where default prompts stop | **Push + Review.** The agent pushes a branch, sets the ticket to Review and comments; a human merges. Per-project opt-in "merge to main when verified" — enabled for TKT to keep the owner's current style. |
| Q-13 Local vs cloud | Decided by the orchestrator: local now; Claude Code cloud sessions are LATER (I-118). |
| Q-14 Who may delegate | Decided by the orchestrator: anyone with write access to the project (D-02 public-project rule applies). |

Consequences for the design in §1:

- **Gone with the helper:** launch tokens, redeem/start endpoints, `AgentLaunch` polling, Credential Manager, installer and signing (old A1, A4, A8 and most of A10). The `ticketing-agent://` scheme is not used.
- **The deep link carries the prompt**, so the prompt must stay short and contain only trusted placeholders (key, type, project key, URLs, repository URL); the agent fetches everything else over MCP. Claude's own handler can be fired by any website anyway, so our link adds no new attack surface; the guardrails block and Claude Code's permission prompts remain the controls.
- **Folder mapping** lives in the browser: the first Delegate on a project asks for the absolute path of the local clone (a text field — browsers cannot reveal absolute paths from a folder picker) and stores it per project in `localStorage`; it can be changed from the button's menu. Every prompt starts by checking `git remote get-url origin` against the project's `repositoryUrl` and stops on a mismatch.
- **Launch choice** in the button menu: Claude Code (terminal, default) or Claude Desktop; the choice is remembered per browser. Links are built with `encodeURIComponent`.
- **History:** clicking Delegate calls `POST /tickets/{key}/agent-delegations` (cookie + XSRF), which writes `ticket.agent.delegated` and applies the per-project toggles (assign if unassigned, ToDo → InProgress). There is no confirmation that the session really started; the agent's own status updates over MCP are the source of truth.
- **Hardening:** destructive MCP tools get `_meta["anthropic/requiresUserInteraction"]`; a Vitest guard keeps `claude-cli:`, `claude:`, `vscode:` and `ticketing-agent:` links stripped from rendered ticket markdown; the UI warns when the ticket was last edited by a non-member of a public project.

### Revised breakdown (replaces §4's A1–A10)

| # | Ticket | Type | Pts | Deps |
| --- | --- | --- | --- | --- |
| B1 | Spike: verify Claude deep links on Windows (quoting, length, browser dialogs, Desktop link) | Spike | 2 | – |
| B2 | Prompt templates: model, renderer, versions, built-ins, REST (old A2 without launch parts) | Technical | 8 | – |
| B3 | Project agent setup, resolved prompt, `get_agent_prompt`, `TICKETING_PUBLIC_URL` (old A3 + merge-policy opt-in + on-delegate toggles) | Technical | 3 | B2 |
| B4 | Delegate button: deep link, folder mapping, Copy/Preview prompt, history entry (old A6 reworked) | User story | 5 | B1, B3 |
| B5 | Agent tab in project settings (old A5) | User story | 8 | B2, B3 |
| B6 | Admin defaults and guardrails page (old A7) | User story | 3 | B2, B5 |
| B7 | Default prompts per type, MCP interaction hints, dogfooding in TKT (old A9) | Technical | 3 | B2, B4 |
| B8 | Security review: threat model for deep-link delegation and prompt injection (old A10, reduced) | Technical | 3 | B4, B7 |

**Total 35 points.** First usable increment: B2 + B3 + Copy prompt from B4.
