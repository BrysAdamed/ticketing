/// Every feature flag the SPA reads (D-168). Each key must be declared in the C# catalog,
/// `src/Ticketing.Application/FeatureFlags/FeatureFlagCatalog.cs`, with its default; a backend
/// test fails when one is missing. Keep one `export const` per key.
export const AGENT_FLAG = 'agent.delegate';
export const ACHIEVEMENTS_FLAG = 'achievements';
export const SUBTICKETS_GRAPH_FLAG = 'ticket.subtickets-graph';

export type FlagKey = typeof AGENT_FLAG | typeof ACHIEVEMENTS_FLAG | typeof SUBTICKETS_GRAPH_FLAG;
