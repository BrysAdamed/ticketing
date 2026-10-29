using System.ComponentModel;
using ModelContextProtocol.Server;
using Ticketing.Application.Achievements;

namespace Ticketing.Api.Mcp;

/// <summary>Your own achievements and sharing them (spec 15.6, 15.7): listed only while the <c>achievements</c> flag is on for the token's user.</summary>
[McpServerToolType]
public sealed class AchievementTools
{
    [FeatureGate(typeof(AchievementsGate))]
    [McpServerTool(Name = "list_my_achievements", ReadOnly = true, Idempotent = true, Title = "List my achievements")]
    [Description("Lists your own achievements (never anyone else's): { startedAt, items }. startedAt is when counting started for you; "
        + "only activity since then counts. items is the whole catalogue in order, each with id, name, description, howToEarn, icon "
        + "(a Tabler icon name), secret, masked, tier (the highest tier you earned, 0 for none), tiers ([{ tier, threshold, unlockedAt, "
        + "seenAt }], dates null while not earned or not seen) and progress ({ count, nextTier, nextThreshold }: your live count and the "
        + "next tier to earn, both null once the top tier is earned). A secret achievement you have not earned is masked: masked is true "
        + "and id, name, description, howToEarn, icon and progress are null. Fails with achievements.disabled when achievements are off "
        + "for you or you opted out.")]
    public static Task<MyAchievementsDto> ListMyAchievements(ListMyAchievements.Handler handler, CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new ListMyAchievements.Query(), cancellationToken);

    [FeatureGate(typeof(AchievementsGate))]
    [McpServerTool(Name = "share_achievement", Idempotent = true, Destructive = false, Title = "Share an achievement")]
    [Description("Shares one of your earned achievements with every signed-in user: they see its name, icon and your highest tier "
        + "(tiers you earn later included), never dates. Sharing again changes nothing. Returns the item in the list_my_achievements "
        + "shape, with shared true. Fails with achievements.notEarned when you have not earned it (unknown ids too) and "
        + "achievements.disabled when achievements are off for you or you opted out.")]
    public static Task<AchievementDto> ShareAchievement(
        SetAchievementSharing.Handler handler,
        [Description("Achievement id from list_my_achievements, for example reporter.")] string id,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new SetAchievementSharing.Command(id, Shared: true), cancellationToken);

    [FeatureGate(typeof(AchievementsGate))]
    [McpServerTool(Name = "unshare_achievement", Idempotent = true, Destructive = false, Title = "Stop sharing an achievement")]
    [Description("Stops sharing one of your earned achievements; it is visible only to you again. Unsharing an unshared achievement "
        + "changes nothing. Returns the item in the list_my_achievements shape, with shared false. Fails with achievements.notEarned "
        + "when you have not earned it and achievements.disabled when achievements are off for you or you opted out.")]
    public static Task<AchievementDto> UnshareAchievement(
        SetAchievementSharing.Handler handler,
        [Description("Achievement id from list_my_achievements, for example reporter.")] string id,
        CancellationToken cancellationToken = default) =>
        handler.HandleAsync(new SetAchievementSharing.Command(id, Shared: false), cancellationToken);
}
