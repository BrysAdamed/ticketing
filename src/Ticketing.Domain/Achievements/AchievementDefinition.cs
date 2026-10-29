using System.Text.RegularExpressions;

namespace Ticketing.Domain.Achievements;

/// <summary>
/// One entry of the <see cref="AchievementCatalog"/> (spec 15.2). <see cref="Id"/> is stored with every earned tier and is never
/// renamed. <see cref="Tiers"/> are ascending count thresholds; a once-only achievement has the single threshold 1. Non-secret
/// entries carry a <see cref="HowToEarn"/> hint; secret ones have none, because they stay masked until earned.
/// </summary>
public sealed partial record AchievementDefinition
{
    public const int IdMaxLength = 50;

    public AchievementDefinition(string id, string name, string description, string? howToEarn, string icon, IReadOnlyList<int> tiers, bool secret = false)
    {
        if (id.Length > IdMaxLength || !IdPattern().IsMatch(id))
            throw new ArgumentException($"'{id}' is not a lower-case kebab-case id of at most {IdMaxLength} characters.", nameof(id));
        ArgumentException.ThrowIfNullOrWhiteSpace(name);
        ArgumentException.ThrowIfNullOrWhiteSpace(description);
        if (secret != string.IsNullOrWhiteSpace(howToEarn))
            throw new ArgumentException($"'{id}': non-secret achievements need a how-to-earn hint and secret ones must not have one.", nameof(howToEarn));
        if (!IconPattern().IsMatch(icon))
            throw new ArgumentException($"'{icon}' is not a Tabler icon name.", nameof(icon));
        if (tiers.Count == 0 || tiers[0] < 1 || tiers.Zip(tiers.Skip(1)).Any(p => p.Second <= p.First))
            throw new ArgumentException($"'{id}': tiers must be ascending positive thresholds.", nameof(tiers));

        Id = id;
        Name = name;
        Description = description;
        HowToEarn = howToEarn;
        Icon = icon;
        Tiers = tiers;
        Secret = secret;
    }

    public string Id { get; }

    public string Name { get; }

    public string Description { get; }

    public string? HowToEarn { get; }

    /// <summary>A Tabler icon name in kebab case, for example <c>file-plus</c>.</summary>
    public string Icon { get; }

    public IReadOnlyList<int> Tiers { get; }

    public bool Secret { get; }

    public int TopTier => Tiers.Count;

    /// <summary>The highest tier (1-based) whose threshold <paramref name="count"/> reaches; 0 when none.</summary>
    public int TierFor(int count) => Tiers.Count(threshold => count >= threshold);

    /// <summary>The threshold of the next tier after <paramref name="count"/>; null when the top tier is reached.</summary>
    public int? NextThreshold(int count) => Tiers.Where(threshold => threshold > count).Select(t => (int?)t).FirstOrDefault();

    [GeneratedRegex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")]
    private static partial Regex IdPattern();

    [GeneratedRegex("^[a-z][a-z0-9]*(-[a-z0-9]+)*$")]
    private static partial Regex IconPattern();
}
