# 10. Ordering with fractional-index rank keys

- Status: Accepted
- Date: 2026-10-26

## Context

Backlogs and boards are ordered by drag and drop ([spec §6.4](../product/01-refined-spec.md#64-backlog-and-boards), [§6.6](../product/01-refined-spec.md#66-ranking)). A ticket sits in exactly one container: its project backlog or one board. A board column shows the board's order filtered by status. Moves must be cheap (one row in the normal case), safe under concurrent drags, and predictable enough that the UI can update optimistically ([spec §10](../product/01-refined-spec.md#10-non-functional-requirements)).

## Decision

- **Key format.** `Rank` is a base-62 fractional-index string, the algorithm of the npm `fractional-indexing` package (v4.0.0, digits `0-9A-Za-z`). The column is `text(128)` with `COLLATE "C"` (byte order). .NET compares with `string.CompareOrdinal`, TypeScript with `<`.
- **Implementation.** `FractionalIndex.KeyBetween(a, b)` and `NKeysBetween(a, b, n)` in `Ticketing.Domain`, a C# port verified against the npm package on 11 000 generated cases ([tech-stack.md](../research/tech-stack.md) §8). The parity fixture stays as a unit test. The SPA uses the npm package for optimistic previews only.
- **Server computes ranks.** Clients send the target container and neighbours (`beforeKey` / `afterKey`, or ids); never a rank. Lists order by `(rank, id)` so the result is deterministic even if two keys were ever equal.
- **Positions** (spec §6.4):
  - new ticket in the backlog → `KeyBetween(last, null)` (bottom);
  - returned to the backlog → `KeyBetween(null, first)` (top);
  - placed on a board without a position → bottom of the board order, which is the bottom of its column;
  - between neighbours A and B → `KeyBetween(A.Rank, B.Rank)`; into an empty column → after the board's last rank.
  - Multi-ticket moves use `NKeysBetween` so the selection keeps its relative order.
- **Concurrency.** Every operation that assigns ranks takes a row lock on the target container (`SELECT ... FOR UPDATE` on the project row for a backlog, the board row for a board) before reading neighbours. A move between containers locks both, in id order, to avoid deadlocks. Ticket creation already holds the project row lock through the counter update ([ADR 0005](0005-postgresql-and-ef-core.md)).
- **Rebalancing rule.** If a generated key is longer than **64** characters, or the two neighbours have equal ranks, the server rebalances the whole container in the same transaction: read its tickets in `(rank, id)` order, assign `NKeysBetween(null, null, n)` (evenly spaced short keys, order preserved), then compute the requested position again. Rebalancing writes no activity entries; rank is never shown to users.
- **Indexes.** `(project_id, rank) WHERE board_id IS NULL` for backlogs and `(board_id, rank) WHERE board_id IS NOT NULL` for boards, both excluding deleted tickets.

## Consequences

- A normal move updates one row and writes one `ticket.moved` entry (or none for a reorder inside the same container).
- Each extra character buys about six halvings of a gap (log2 62), so reaching 64 characters takes several hundred consecutive drops into the same gap. Appends at either end stay short. A rebalance is therefore rare, and bounded by the container size (at most a few thousand rows in a backlog, 500 on a board).
- A rebalance changes `xmin` on every ticket in the container. A user editing one of those tickets at that moment gets a `409` and a refresh.
- The container lock serializes moves within one backlog or board. At the expected scale (D-04) that is milliseconds of waiting and it removes the need for retry logic.
- One rank per ticket serves both the backlog and the board. Boards cannot have an order independent of the backlog for the same ticket, which matches the single-container rule.

## Alternatives considered

- **Floating-point positions.** Run out of precision after about 50 bisections at one spot and then need a rebalance anyway, with less predictable timing.
- **Integer positions with renumbering.** Every insert rewrites all rows below it: noisy, slow on a 50 000-ticket backlog, and conflict-prone.
- **Unique index on `(container, rank)` with retry on collision, and an offline normalization job** (research proposal). Avoids locks, but adds retry paths and a background job. The spec requires inline rebalancing; the container lock makes collisions impossible.
- **Linked list (previous/next pointers).** Ordered reads need recursive queries; moves touch three rows.
- **Jira-style LexoRank with buckets.** Same idea with more machinery; the bucket rotation solves a scale problem we do not have.
