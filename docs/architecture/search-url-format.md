# Search URL format

Normative for everyone who links to ticket search: the search page, the dashboard ("every count links to the search that produces it", spec §7), backlog/board "open in search" links and scripts. Spec §6.8, I-03, I-21.

One query-string format serves both:

| Where | URL |
| --- | --- |
| Search page (SPA) | `/search?<filters>` |
| REST search | `GET /api/v1/tickets/search?<filters>&limit=&cursor=` |
| CSV export | `GET /api/v1/tickets/search/export.csv?<filters>` |

The SPA copies its query string to the API unchanged (minus UI-only parameters), so a link built for one works for the other. A saved filter is a bookmark of the page URL.

## Encoding rules

* Parameter names are case-sensitive and written exactly as below. Unknown parameters are ignored.
* **Lists** are comma-separated: `status=InProgress,Review`. Repeating the parameter is equivalent (`status=InProgress&status=Review`); the values are merged.
* Within one parameter values are OR-ed (any of), except `label`, which is AND-ed (all of). Different parameters are AND-ed.
* **Enum values** are the exact PascalCase names of spec §3 (`ReadyForTesting`). Matching is case-insensitive on input; links should use the canonical spelling.
* **Dates** are ISO 8601. A plain date (`2026-10-01`) means the whole UTC day: `…From` is inclusive from 00:00, `…To` is inclusive to the end of that day. A full timestamp (`2026-10-01T12:00:00Z`) is used as-is (`From` inclusive, `To` exclusive).
* Values are percent-encoded as usual (`URLSearchParams`). A literal comma cannot appear in a list value; the only free-text parameters (`q`, `version`) are single-valued and are not split.
* An empty parameter (`status=`) is the same as an absent one.
* Invalid values (unknown enum name, malformed date or key) give `400 validation` from the API with the parameter name in `errors`. The search page shows the chip in an error state instead of silently dropping it.

## Filters

| Parameter | Values | Meaning |
| --- | --- | --- |
| `project` | project keys, list | Tickets in any of these projects. Unreadable or unknown keys match nothing (no error, so links never reveal private projects). Absent = every readable project. |
| `q` | text | Full text over title (weight A) and description (weight B) with `websearch_to_tsquery('english')` syntax (`"exact phrase"`, `-exclude`, `or`), OR a case-insensitive substring of the title (partial words, trigram index). A ticket key (`WEB-42`) also matches that ticket. |
| `type` | `Epic`, `UserStory`, `Technical`, `Spike`, `Bug` | |
| `status` | `ToDo`, `InProgress`, `OnHold`, `Review`, `ReadyForTesting`, `Testing`, `ReadyForDeploy`, `Done` | |
| `category` | `ToDo`, `InProgress`, `Done` | Status category (spec §3). "Open" is `category=ToDo,InProgress`. Combined with `status` by AND. |
| `priority` | `Highest`, `High`, `Medium`, `Low`, `Lowest` | |
| `severity` | `Blocker`, `Critical`, `Major`, `Minor`, `Trivial`, `none` | `none` = severity not set. |
| `assignee` | `me`, `unassigned`, user id or email, list | |
| `assigneeNot` | `me`, `unassigned`, user id or email, list | Excludes these assignees (`unassigned` excludes tickets without an assignee). The dashboard's "Others" bucket: `assigneeNot=<top 10 ids>,unassigned`. |
| `reporter` | `me`, user id or email, list | |
| `label` | labels, list | Tickets having **all** of them. Labels are lower-cased on input. |
| `version` | text | Exact, case-sensitive version (spec §4.5). `version=none` = no version. |
| `parent` | ticket key or id | Direct children of that ticket. |
| `location` | `backlog`, `board`, or a board id | In a project backlog; on any board; on that board. |
| `createdFrom`, `createdTo` | date or timestamp | Created in range. |
| `updatedFrom`, `updatedTo` | date or timestamp | Updated in range. Stale tickets (dashboard widget 8): `category=ToDo,InProgress&updatedTo=<now − 30 days as a UTC timestamp>&sort=updated&order=asc`. |
| `resolvedFrom`, `resolvedTo` | date or timestamp | Entered Done in range (`ResolvedAt`). For the dashboard's created-vs-resolved widget. |
| `fromRegression` | `true` | Only tickets created as bugs from a regression session item, from any session, cancelled ones included (dashboard widget 12). |
| `watching` | `true` | Only tickets the caller watches (I-32, D-93). `false` or absent = no filter. Like every filter it applies only within readable projects. |

Deleted tickets are never returned (spec §6.8 "include deleted = no").

## Sort

| Parameter | Values | Default |
| --- | --- | --- |
| `sort` | `updated`, `created`, `priority`, `key`, `rank` | `updated` |
| `order` | `asc`, `desc` | `desc` for `updated` and `created`; `asc` for the others (`priority=asc` lists Highest first). |

Ties are broken by ticket id in the same direction, so paging is stable. `key` orders by project key, then number. `rank` orders by the stored fractional rank; it is only meaningful inside one container (one project's backlog via `project=WEB&location=backlog`, or one board via `location=<boardId>`).

## Paging (API only)

`limit` (1..100, default 25) and `cursor` (opaque `nextCursor` from the previous page). The cursor is bound to the sort; changing `sort` or `order` with an old cursor gives `400 validation`. The response is `{ items, nextCursor, total, totalCapped }`: `total` is counted on the first page only (null on later pages), capped at 1000 (`totalCapped: true` means "1000+"). The export ignores paging and returns at most 10 000 rows in the requested order.

## UI-only parameters (search page)

Not sent to the API: `peek=<ticket key>` (open peek panel, layout-and-screens §peek panel) and `scope=docs` (the `Tickets | Docs` switch; absent means tickets).

## Docs search

The search page with `scope=docs` and `GET /api/v1/docs/search?<filters>&limit=&cursor=` share one format (spec §12.7). The encoding rules above apply.

| Parameter | Values | Meaning |
| --- | --- | --- |
| `project` | project keys, list | Docs in any of these projects; unreadable or unknown keys match nothing. |
| `q` | text | Full text over title (weight A) and the latest published content or Canvas labels (weight B), `websearch_to_tsquery('english')` syntax, OR a case-insensitive substring of the title (3+ characters), OR a doc key (`WEB-D-12`). Drafts are never searched. |
| `kind` | `Folder`, `Page`, `Diagram`, list | |
| `folder` | folder key or id | Docs anywhere below that folder. A doc that is not a folder is `400 validation`; an unreadable one matches nothing. |
| `mentions` | ticket key or id | Docs whose latest content mentions the ticket. |
| `updatedFrom`, `updatedTo` | date or timestamp | Updated in range. |
| `sort` | `relevance`, `updated` | `relevance` (default with `q`): best match first, at most 100, no cursor. `updated` (default and only sort without `q`): newest first, keyset cursor. |

The response is `{ items, nextCursor, total, totalCapped, sort }` with `sort` the one applied; each item has a plain-text `snippet` with highlight ranges. Examples: `/search?scope=docs&q=idempotency`, `/search?scope=docs&project=WEB&folder=WEB-D-3&kind=Page`, `/search?scope=docs&mentions=WEB-42`.

## Examples

| Link | URL |
| --- | --- |
| My open work | `/search?assignee=me&category=ToDo,InProgress` |
| Open bugs in WEB by severity Critical | `/search?project=WEB&type=Bug&severity=Critical&category=ToDo,InProgress` |
| WEB tickets in status Review (dashboard widget 2) | `/search?project=WEB&status=Review` |
| Unassigned open tickets in WEB, version 1.4.0 | `/search?project=WEB&assignee=unassigned&category=ToDo,InProgress&version=1.4.0` |
| Created in ISO week 2026-W43 | `/search?project=WEB&createdFrom=2026-10-19&createdTo=2026-10-25` |
| Resolved in ISO week 2026-W43 | `/search?project=WEB&resolvedFrom=2026-10-19&resolvedTo=2026-10-25` |
| Children of epic WEB-12 | `/search?parent=WEB-12&sort=rank` |
| Text search, newest first | `/search?q=login%20timeout&sort=created` |
| Open regression bugs | `/search?project=WEB&fromRegression=true&category=ToDo,InProgress` |
| Open tickets I watch | `/search?watching=true&category=ToDo,InProgress` |

## MCP mapping

`search_docs` takes `text` ← `q`, `projectKeys` ← `project`, `kinds` ← `kind`, `folder`, `mentions`, `updatedFrom`/`updatedTo`, `sort`, `limit`, `cursor`.

`search_tickets` (spec §9.3) takes the same filters as JSON with these names: `projectKeys` ← `project`, `text` ← `q`, `types`, `statuses`, `statusCategory` (list) ← `category`, `priorities`, `severities`, `assignee` (list), `assigneeNot` (list), `reporter` (list), `labels`, `version`, `parentKey`, `location`, `createdFrom`/`createdTo`, `updatedFrom`/`updatedTo`, `resolvedFrom`/`resolvedTo`, `fromRegression`, `watching`, `sort`, `order`, `limit`, `cursor`.
