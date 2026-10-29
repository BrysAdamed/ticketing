using Ticketing.Domain.Achievements;

namespace Ticketing.Application.Achievements;

/// <summary>The caller's achievements (spec 15.6): the whole catalogue in catalogue order, and when counting started (S).</summary>
public sealed record MyAchievementsDto(DateTimeOffset StartedAt, IReadOnlyList<AchievementDto> Items);

/// <summary>
/// One catalogue entry for the caller. A secret entry the caller has not earned is <paramref name="Masked"/>: every field that
/// would reveal it is null, it has no tiers and no progress.
/// </summary>
/// <param name="Tier">The highest tier the caller earned; 0 while none.</param>
/// <param name="Tiers">Every tier with its threshold, and when the caller earned and saw it (null while not).</param>
/// <param name="Progress">The caller's live count towards the next tier.</param>
public sealed record AchievementDto(
    string? Id,
    string? Name,
    string? Description,
    string? HowToEarn,
    string? Icon,
    bool Secret,
    bool Masked,
    int Tier,
    IReadOnlyList<AchievementTierDto> Tiers,
    AchievementProgressDto? Progress)
{
    internal static AchievementDto From(AchievementDefinition definition, IReadOnlyCollection<EarnedTier> earned, int count)
    {
        if (definition.Secret && earned.Count == 0)
            return new(null, null, null, null, null, Secret: true, Masked: true, 0, [], null);

        var tier = earned.Count == 0 ? 0 : earned.Max(e => e.Tier);
        var tiers = definition.Tiers
            .Select((threshold, index) => (Tier: index + 1, Threshold: threshold))
            .Select(t => earned.FirstOrDefault(e => e.Tier == t.Tier) is { } e
                ? new AchievementTierDto(t.Tier, t.Threshold, e.UnlockedAt, e.SeenAt)
                : new AchievementTierDto(t.Tier, t.Threshold, null, null))
            .ToList();
        var next = tier < definition.TopTier ? tier + 1 : (int?)null;
        var progress = new AchievementProgressDto(count, next, next is { } n ? definition.Tiers[n - 1] : null);
        return new(definition.Id, definition.Name, definition.Description, definition.HowToEarn, definition.Icon, definition.Secret, Masked: false, tier, tiers, progress);
    }
}

/// <param name="UnlockedAt">When the caller earned this tier; null while not earned.</param>
/// <param name="SeenAt">When the caller saw the unlock; null while unseen or not earned.</param>
public sealed record AchievementTierDto(int Tier, int Threshold, DateTimeOffset? UnlockedAt, DateTimeOffset? SeenAt);

/// <param name="Count">The caller's current count since S, computed live.</param>
/// <param name="NextTier">The tier after the highest earned one; null once the top tier is earned.</param>
/// <param name="NextThreshold">That tier's threshold. The count can already reach it for a moment before the tier is awarded.</param>
public sealed record AchievementProgressDto(int Count, int? NextTier, int? NextThreshold);

/// <summary>The caller's earned tiers not seen yet, oldest unlock first (the unlock toast's poll).</summary>
public sealed record UnseenAchievementsDto(int Count, IReadOnlyList<UnseenAchievementDto> Items);

public sealed record UnseenAchievementDto(string Id, string Name, int Tier, string Icon);

internal sealed record EarnedTier(int Tier, DateTimeOffset UnlockedAt, DateTimeOffset? SeenAt);
