# 1. Record architecture decisions

- Status: Accepted
- Date: 2026-10-26

## Context

Ticketing is built by several people and several AI agents in parallel. Without a record, technical choices get re-argued in every pull request, and nobody knows whether a pattern in the code is deliberate. Product questions already have a log in [decisions.md](../decisions.md) (`D-xx`, `Q-xx`). Technical decisions (frameworks, persistence, auth mechanics, test strategy) have no home.

## Decision

- Technical decisions are recorded as Architecture Decision Records in `docs/adr/`, in Michael Nygard's format: Status, Context, Decision, Consequences, plus Alternatives considered.
- Files are named `NNNN-kebab-title.md`, numbered in order, never renumbered. [README.md](README.md) is the index.
- Product decisions stay in `decisions.md`. An ADR cites `D-xx` and spec sections instead of restating them. The [refined spec](../product/01-refined-spec.md) is normative; an ADR must not contradict it. If a technical constraint forces a spec change, the spec changes first.
- Status values: `Proposed`, `Accepted`, `Superseded by NNNN`, `Deprecated`. An accepted ADR is not edited for substance. A changed decision gets a new ADR that supersedes the old one, and the old one's status is updated.
- An ADR is written when a decision is costly to reverse, affects more than one feature, or would surprise a new developer.

## Consequences

- New contributors and agents can read `docs/adr/` to learn why the code looks the way it does.
- Writing an ADR adds a small cost to structural changes. That cost is intended.
- Two logs exist (product and technical). Each links to the other where they meet.

## Alternatives considered

- **One combined log in `decisions.md`.** Mixes product owner choices with implementation details; product readers would wade through EF Core mapping notes.
- **No written record, rely on commit messages.** Not discoverable, and superseded decisions are invisible.
