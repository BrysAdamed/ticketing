namespace Ticketing.Application.FeatureFlags;

/// <summary>
/// A feature flag declared in code (D-169): its key, the description Admins see, and the configuration a new instance starts
/// with. Default on means enabled for 100% of users, default off means disabled.
/// </summary>
public sealed record FeatureFlagDefinition(string Key, string Description, bool DefaultOn);

/// <summary>
/// Every feature flag the code reads. Feature code refers to these definitions, never to a key string, and the SPA mirrors the
/// keys in <c>web/src/app/core/flags/flag-keys.ts</c>. Removing an entry retires the flag's row; it is never deleted by a deploy.
/// </summary>
public static class FeatureFlagCatalog
{
    public static readonly FeatureFlagDefinition AgentDelegate = new(
        "agent.delegate",
        "Delegate to agent: copy a ready prompt for a coding agent from a ticket (spec 13). Also needs TICKETING_PUBLIC_URL.",
        DefaultOn: false);

    public static readonly FeatureFlagDefinition Achievements = new(
        "achievements",
        "Achievements: private, tiered recognition for real actions, with an opt-out on the profile (spec 15).",
        DefaultOn: true);

    public static readonly FeatureFlagDefinition SubticketsGraph = new(
        "ticket.subtickets-graph",
        "Graph view of a ticket's sub-tickets and their links, which each user can switch to on the ticket.",
        DefaultOn: true);

    public static IReadOnlyList<FeatureFlagDefinition> All { get; } = [AgentDelegate, Achievements, SubticketsGraph];
}

/// <summary>The declared flags the running instance uses; <see cref="FeatureFlagCatalog.All"/> outside tests.</summary>
public interface IFeatureFlagCatalog
{
    IReadOnlyList<FeatureFlagDefinition> Definitions { get; }

    FeatureFlagDefinition? Find(string key);
}

/// <summary>An <see cref="IFeatureFlagCatalog"/> over a fixed list of definitions.</summary>
public sealed class FeatureFlagCatalogSource(IReadOnlyList<FeatureFlagDefinition> definitions) : IFeatureFlagCatalog
{
    private readonly Dictionary<string, FeatureFlagDefinition> _byKey = definitions.ToDictionary(d => d.Key, StringComparer.Ordinal);

    public IReadOnlyList<FeatureFlagDefinition> Definitions => definitions;

    public FeatureFlagDefinition? Find(string key) => _byKey.GetValueOrDefault(key);
}
