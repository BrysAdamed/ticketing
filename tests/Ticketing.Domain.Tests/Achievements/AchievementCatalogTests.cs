using Ticketing.Domain.Achievements;
using Ticketing.Domain.Users;

namespace Ticketing.Domain.Tests.Achievements;

public sealed class AchievementCatalogTests
{
    [Fact]
    public void The_catalogue_holds_the_achievements_with_unique_ids()
    {
        // Act
        var ids = AchievementCatalog.All.Select(a => a.Id).ToList();

        // Assert
        Assert.Equal(
            [
                "reporter", "closer", "ready-for-review", "bug-hunter", "exterminator", "conversationalist", "connector", "show-me", "triage",
                "test-author", "regression-runner", "found-it", "full-sweep", "board-builder", "spring-cleaning", "delegator", "machine-whisperer",
                "epic-finisher", "shout-out",
            ],
            ids);
        Assert.Equal(ids.Count, ids.Distinct().Count());
        Assert.Empty(AchievementCatalog.All.Where(a => a.Secret).Select(a => a.Id));
        Assert.All(AchievementCatalog.All, a => Assert.Equal(a.Secret, string.IsNullOrWhiteSpace(a.HowToEarn)));
    }

    [Theory]
    [InlineData("epic-finisher")]
    [InlineData("shout-out")]
    public void Event_achievements_are_earned_once(string id)
    {
        // Act
        var definition = AchievementCatalog.Find(id)!;

        // Assert
        Assert.Equal([1], definition.Tiers);
    }

    [Theory]
    [InlineData(0, 0, 1)]
    [InlineData(1, 1, 10)]
    [InlineData(9, 1, 10)]
    [InlineData(10, 2, 50)]
    [InlineData(249, 3, 250)]
    [InlineData(250, 4, null)]
    [InlineData(1000, 4, null)]
    public void Tiers_follow_the_thresholds(int count, int tier, int? next)
    {
        // Arrange
        var reporter = AchievementCatalog.Find(AchievementCatalog.Reporter)!;

        // Act
        var result = (reporter.TierFor(count), reporter.NextThreshold(count));

        // Assert
        Assert.Equal((tier, next), result);
    }

    [Fact]
    public void A_once_only_achievement_has_the_single_threshold_one()
    {
        // Act
        var boardBuilder = AchievementCatalog.Find(AchievementCatalog.BoardBuilder)!;

        // Assert
        Assert.Equal([1], boardBuilder.Tiers);
        Assert.Equal((0, 1, 1), (boardBuilder.TierFor(0), boardBuilder.TierFor(1), boardBuilder.TierFor(5)));
    }

    [Theory]
    [InlineData("Not-Kebab", "file-plus", false, "hint", new[] { 1 })]
    [InlineData("ok", "tablerFilePlus", false, "hint", new[] { 1 })]
    [InlineData("ok", "file-plus", false, null, new[] { 1 })]
    [InlineData("ok", "file-plus", true, "a secret must not have a hint", new[] { 1 })]
    [InlineData("ok", "file-plus", false, "hint", new int[0])]
    [InlineData("ok", "file-plus", false, "hint", new[] { 0, 1 })]
    [InlineData("ok", "file-plus", false, "hint", new[] { 5, 5 })]
    public void Invalid_definitions_are_rejected(string id, string icon, bool secret, string? hint, int[] tiers)
    {
        // Act
        var act = () => new AchievementDefinition(id, "Name", "Description", hint, icon, tiers, secret);

        // Assert
        Assert.Throws<ArgumentException>(act);
    }

    [Fact]
    public void An_earned_tier_must_exist_in_the_catalogue()
    {
        // Arrange
        var userId = Guid.NewGuid();
        var now = DateTimeOffset.UtcNow;

        // Act
        var earned = UserAchievement.Create(userId, AchievementCatalog.Closer, 4, now);

        // Assert
        Assert.Equal((userId, "closer", (short)4, now, (DateTimeOffset?)null), (earned.UserId, earned.AchievementId, earned.Tier, earned.UnlockedAt, earned.SeenAt));
        Assert.Throws<ArgumentException>(() => UserAchievement.Create(userId, "unknown", 1, now));
        Assert.Throws<ArgumentOutOfRangeException>(() => UserAchievement.Create(userId, AchievementCatalog.Closer, 5, now));
        Assert.Throws<ArgumentOutOfRangeException>(() => UserAchievement.Create(userId, AchievementCatalog.Closer, 0, now));
    }

    [Fact]
    public void Seen_is_set_once()
    {
        // Arrange
        var earned = UserAchievement.Create(Guid.NewGuid(), AchievementCatalog.Reporter, 1, DateTimeOffset.UtcNow);
        var first = DateTimeOffset.UtcNow.AddMinutes(1);

        // Act
        earned.MarkSeen(first);
        earned.MarkSeen(first.AddMinutes(1));

        // Assert
        Assert.Equal(first, earned.SeenAt);
    }

    [Fact]
    public void The_start_is_stamped_once_cleared_by_opting_out_and_restarted_by_opting_in()
    {
        // Arrange
        var user = User.Create("someone@ticketing.test", "Someone", GlobalRole.User, null, DateTimeOffset.UtcNow);
        var t0 = DateTimeOffset.UtcNow;

        // Act
        var stamped = user.StartAchievements(t0);
        var again = user.StartAchievements(t0.AddDays(1));
        var keptStart = user.AchievementsStartedAt;
        user.OptOutOfAchievements();
        var whileHidden = user.StartAchievements(t0.AddDays(2));
        var hiddenStart = user.AchievementsStartedAt;
        user.OptInToAchievements(t0.AddDays(3));

        // Assert
        Assert.Equal((true, false, t0), (stamped, again, keptStart));
        Assert.Equal((false, (DateTimeOffset?)null), (whileHidden, hiddenStart));
        Assert.Equal((false, t0.AddDays(3)), (user.AchievementsHidden, user.AchievementsStartedAt));
    }
}
