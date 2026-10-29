namespace Ticketing.Domain.Achievements;

/// <summary>
/// One tier of an achievement a user has earned (spec 15.3). Achievements are monotonic: a row is never revoked, only deleted
/// with the rest of the user's achievement data on opt-out. No project or ticket id is stored, so nothing here can reveal a
/// private project.
/// </summary>
public sealed class UserAchievement
{
    private UserAchievement()
    {
        AchievementId = null!;
    }

    public Guid UserId { get; private set; }

    public string AchievementId { get; private set; }

    public short Tier { get; private set; }

    public DateTimeOffset UnlockedAt { get; private set; }

    public DateTimeOffset? SeenAt { get; private set; }

    /// <summary>
    /// When the owner shared the achievement (spec 15.7). Kept on the tier-1 row only, which exists whenever any tier is earned;
    /// sharing shows the highest tier, including tiers earned later.
    /// </summary>
    public DateTimeOffset? SharedAt { get; private set; }

    public static UserAchievement Create(Guid userId, string achievementId, int tier, DateTimeOffset unlockedAt)
    {
        if (userId == Guid.Empty)
            throw new ArgumentException("An achievement needs a user.", nameof(userId));
        var definition = AchievementCatalog.Find(achievementId)
            ?? throw new ArgumentException($"'{achievementId}' is not in the achievement catalogue.", nameof(achievementId));
        if (tier < 1 || tier > definition.TopTier)
            throw new ArgumentOutOfRangeException(nameof(tier), tier, $"'{achievementId}' has tiers 1 to {definition.TopTier}.");
        return new UserAchievement { UserId = userId, AchievementId = achievementId, Tier = (short)tier, UnlockedAt = unlockedAt };
    }

    public void MarkSeen(DateTimeOffset now) => SeenAt ??= now;

    public void Share(DateTimeOffset now) => SharedAt ??= now;

    public void Unshare() => SharedAt = null;
}
