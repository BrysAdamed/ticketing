# 7. Feature flags with Microsoft.FeatureManagement and a database-backed provider

- Status: Accepted
- Date: 2026-10-26
- Note (2026-10-31): flags are now declared in code with a default and synced into this table at startup; Admins no longer create flags, they only change targeting, reset to the default, and delete retired flags. Unknown flags still evaluate off; a declared flag without a row evaluates to its default. See [D-168](../decisions.md).

## Context

The brief asks for a feature-flag mechanism and views that can host A/B tests later (D-14). The spec fixes the flag data model and the evaluation algorithm, including a bucketing hash that C# and TypeScript must compute identically ([spec §4.15](../product/01-refined-spec.md#415-featureflag), [§6.13](../product/01-refined-spec.md#613-feature-flags-and-view-variants)). Admins edit flags in the UI, so definitions live in the database, not in `appsettings.json`.

## Decision

- **Library:** `Microsoft.FeatureManagement.AspNetCore` 4.8.0 for the server-side API (`IVariantFeatureManagerSnapshot`, `.WithFeatureGate(...)` on endpoints).
- **Storage:** table `feature_flag` with the typed columns of spec §4.15 (`key`, `enabled`, `rollout_percentage`, `target_user_ids`, `target_roles`, ...).
- **Provider:** `DbFeatureDefinitionProvider : IFeatureDefinitionProvider`, registered before `AddFeatureManagement()`. It loads all rows, caches them for 30 seconds, and is invalidated explicitly after an admin edit. Each row maps to a `FeatureDefinition`:
  - `enabled = false` → disabled;
  - otherwise → enabled with one feature filter, `Ticketing.Targeting`, whose parameters are the row's user ids, roles and percentage.
- **Filter:** `TicketingTargetingFilter : IFeatureFilter` implements steps 3 to 6 of spec §6.13 in order, using `ICurrentUser`:
  1. user id in `TargetUserIds` → on;
  2. global role in `TargetRoles` → on;
  3. `bucket(flagKey, userId) < RolloutPercentage` → on;
  4. otherwise off.
  Unknown flags evaluate to off (the library's default for missing features).
- **Bucket function**, one implementation per language, in `Ticketing.Domain` and `web/src/app/core/flags/bucket.ts`:
  `bucket = uint32_big_endian(SHA-256(UTF-8("{flagKey}:{userId}"))[0..4]) mod 100`, where `userId` is the lower-case hyphenated GUID string (`Guid.ToString("D")`, the same form JSON carries). A shared fixture file of `(flagKey, userId, bucket)` triples is asserted by both xUnit and Vitest.
- **Client contract:** `GET /api/v1/me/flags` returns `{ "flags": { "<key>": "<variant>" } }` with `on` or `off` for every defined flag. Variants are strings so multi-variant tests can be added without changing clients. The SPA loads flags in an app initializer and refreshes them on window focus when older than 5 minutes.
- Flag edits are admin-only, cookie-only ([ADR 0003](0003-authentication-cookie-and-pat.md)) and write `ActivityEntry` rows (`flag.updated`).
- The admin list shows how many active users evaluate `on`, computed server-side with the same filter.

## Consequences

- Business code uses the standard FeatureManagement API, and a later move to Azure App Configuration or file-based flags only replaces the provider.
- We do not use the library's built-in `Microsoft.Targeting` filter or its percentile allocation. Both hash `userId` and feature name in their own format, which does not match spec §6.13 and has no TypeScript twin. When multi-variant A/B tests arrive, variant allocation must also use our bucket function (a custom allocation step), or the spec must change.
- With more than one API instance, an edit takes up to 30 seconds to reach the others. Acceptable for v1 (one instance).
- `/me/flags` exposes all flag keys to every signed-in user. Flag keys must not reveal anything sensitive; the admin UI says so.

## Alternatives considered

- **`Microsoft.Targeting` filter with JSON definitions in a `jsonb` column** (the research prototype). Less code and variants for free, but the bucketing differs from the spec and the admin UI would have to produce schema-valid JSON. Rejected for v1; reusable later if the spec drops the cross-language bucket.
- **Hand-written flag service without the library.** Simple, but loses endpoint gates, the snapshot manager and the path to variants and telemetry.
- **Hosted flag services (LaunchDarkly, Unleash).** Cost or another container, and user data leaves the VM.
- **Exposing only flags marked "expose to client"** (research suggestion). Not in the spec data model; deferred unless sensitive flag names appear.
