namespace Ticketing.Domain.Ordering;

/// <summary>Rank rules (spec 6.6) on top of <see cref="FractionalIndex"/>: storage limit, rebalance threshold and rebalancing.</summary>
public static class Ranks
{
    public const int ColumnMaxLength = 128;
    public const int RebalanceThreshold = 64;

    public static StringComparer Comparer => StringComparer.Ordinal;

    public static string Validate(string rank)
    {
        if (string.IsNullOrEmpty(rank) || rank.Length > ColumnMaxLength)
            throw new ArgumentException($"Rank must be 1..{ColumnMaxLength} characters.", nameof(rank));
        return rank;
    }

    public static string Between(string? before, string? after) => FractionalIndex.KeyBetween(before, after);

    public static bool NeedsRebalance(string rank) => rank.Length > RebalanceThreshold;

    /// <summary>
    /// Plans a container rebalance: short, evenly spaced keys for <paramref name="existingCount"/> items in their current order,
    /// leaving a slot at <paramref name="insertIndex"/> for the item being placed.
    /// </summary>
    public static RebalancePlan PlanRebalance(int existingCount, int insertIndex)
    {
        ArgumentOutOfRangeException.ThrowIfNegative(existingCount);
        ArgumentOutOfRangeException.ThrowIfNegative(insertIndex);
        ArgumentOutOfRangeException.ThrowIfGreaterThan(insertIndex, existingCount);

        var keys = FractionalIndex.NKeysBetween(null, null, existingCount + 1);
        var existing = new List<string>(existingCount);
        for (var i = 0; i < keys.Count; i++)
        {
            if (i != insertIndex)
                existing.Add(keys[i]);
        }
        return new RebalancePlan(existing, keys[insertIndex]);
    }
}

/// <param name="ExistingRanks">New ranks for the existing items, in their current order.</param>
/// <param name="InsertedRank">The rank for the item being placed.</param>
public sealed record RebalancePlan(IReadOnlyList<string> ExistingRanks, string InsertedRank);
